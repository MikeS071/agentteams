package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/stripe/stripe-go/v83"
	checkoutsession "github.com/stripe/stripe-go/v83/checkout/session"
	"github.com/stripe/stripe-go/v83/webhook"
)

var ErrInvalidWebhookSignature = errors.New("invalid webhook signature")

type StripeService struct {
	credits *CreditService

	secretKey     string
	webhookSecret string
	price10       string
	price25       string
	price50       string
}

type WebhookResult struct {
	Received        bool    `json:"received"`
	EventType       string  `json:"event_type"`
	TenantID        string  `json:"tenant_id,omitempty"`
	CreditedUSD     float64 `json:"credited_usd,omitempty"`
	CheckoutSession string  `json:"checkout_session,omitempty"`
}

func NewStripeService(credits *CreditService) *StripeService {
	return &StripeService{
		credits:       credits,
		secretKey:     strings.TrimSpace(os.Getenv("STRIPE_SECRET_KEY")),
		webhookSecret: strings.TrimSpace(os.Getenv("STRIPE_WEBHOOK_SECRET")),
		price10:       strings.TrimSpace(os.Getenv("STRIPE_PRICE_10")),
		price25:       strings.TrimSpace(os.Getenv("STRIPE_PRICE_25")),
		price50:       strings.TrimSpace(os.Getenv("STRIPE_PRICE_50")),
	}
}

func (s *StripeService) CreateCheckoutSession(
	_ context.Context,
	tenantID string,
	amountUSD int,
	successURL string,
	cancelURL string,
) (*stripe.CheckoutSession, error) {
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return nil, errors.New("tenant id is required")
	}
	if strings.TrimSpace(successURL) == "" || strings.TrimSpace(cancelURL) == "" {
		return nil, errors.New("success_url and cancel_url are required")
	}
	if s.secretKey == "" {
		return nil, errors.New("missing STRIPE_SECRET_KEY")
	}

	priceID, err := s.priceIDForAmount(amountUSD)
	if err != nil {
		return nil, err
	}

	stripe.Key = s.secretKey
	params := &stripe.CheckoutSessionParams{
		Mode:       stripe.String(string(stripe.CheckoutSessionModePayment)),
		SuccessURL: stripe.String(successURL),
		CancelURL:  stripe.String(cancelURL),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{
				Price:    stripe.String(priceID),
				Quantity: stripe.Int64(1),
			},
		},
		Metadata: map[string]string{
			"tenant_id":       tenantID,
			"credit_amount":   strconv.Itoa(amountUSD),
			"credit_unit":     "usd",
			"credit_package":  fmt.Sprintf("$%d", amountUSD),
			"credit_provider": "stripe_checkout",
		},
		ClientReferenceID: stripe.String(tenantID),
	}

	session, err := checkoutsession.New(params)
	if err != nil {
		return nil, fmt.Errorf("create checkout session: %w", err)
	}
	return session, nil
}

func (s *StripeService) HandleWebhook(ctx context.Context, payload []byte, signature string) (WebhookResult, error) {
	if s.secretKey == "" {
		return WebhookResult{}, errors.New("missing STRIPE_SECRET_KEY")
	}
	if s.webhookSecret == "" {
		return WebhookResult{}, errors.New("missing STRIPE_WEBHOOK_SECRET")
	}
	if strings.TrimSpace(signature) == "" {
		return WebhookResult{}, ErrInvalidWebhookSignature
	}

	event, err := webhook.ConstructEvent(payload, signature, s.webhookSecret)
	if err != nil {
		return WebhookResult{}, fmt.Errorf("%w: %v", ErrInvalidWebhookSignature, err)
	}

	result := WebhookResult{
		Received:  true,
		EventType: string(event.Type),
	}

	if event.Type != "checkout.session.completed" {
		return result, nil
	}

	var checkout struct {
		ID          string            `json:"id"`
		AmountTotal int64             `json:"amount_total"`
		Metadata    map[string]string `json:"metadata"`
	}
	if err := json.Unmarshal(event.Data.Raw, &checkout); err != nil {
		return WebhookResult{}, fmt.Errorf("decode checkout session: %w", err)
	}

	tenantID := strings.TrimSpace(checkout.Metadata["tenant_id"])
	if tenantID == "" {
		tenantID = strings.TrimSpace(checkout.Metadata["tenantId"])
	}
	if tenantID == "" {
		return WebhookResult{}, errors.New("missing tenant id in checkout metadata")
	}

	creditAmountUSD := resolveCreditAmountUSD(checkout.Metadata, checkout.AmountTotal)
	if creditAmountUSD <= 0 {
		return WebhookResult{}, errors.New("invalid credit amount from checkout session")
	}

	reason := fmt.Sprintf("stripe_purchase:%s", checkout.ID)
	if err := s.credits.AddCredits(ctx, tenantID, creditAmountUSD, reason); err != nil {
		return WebhookResult{}, fmt.Errorf("apply purchase credits: %w", err)
	}

	result.TenantID = tenantID
	result.CreditedUSD = creditAmountUSD
	result.CheckoutSession = checkout.ID
	return result, nil
}

func (s *StripeService) priceIDForAmount(amountUSD int) (string, error) {
	switch amountUSD {
	case 10:
		if s.price10 == "" {
			return "", errors.New("missing STRIPE_PRICE_10")
		}
		return s.price10, nil
	case 25:
		if s.price25 == "" {
			return "", errors.New("missing STRIPE_PRICE_25")
		}
		return s.price25, nil
	case 50:
		if s.price50 == "" {
			return "", errors.New("missing STRIPE_PRICE_50")
		}
		return s.price50, nil
	default:
		return "", errors.New("unsupported package amount; allowed values are 10, 25, 50")
	}
}

func resolveCreditAmountUSD(metadata map[string]string, amountTotalCents int64) float64 {
	for _, key := range []string{"credit_amount", "credit_amount_usd", "amount"} {
		if raw := strings.TrimSpace(metadata[key]); raw != "" {
			parsed, err := strconv.ParseFloat(raw, 64)
			if err == nil && parsed > 0 {
				return parsed
			}
		}
	}

	if amountTotalCents <= 0 {
		return 0
	}
	return float64(amountTotalCents) / centsPerDollar
}
