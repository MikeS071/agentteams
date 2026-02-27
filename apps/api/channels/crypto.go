package channels

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

const (
	secretIVBytes = 12
)

func encryptionKey() ([]byte, error) {
	keyHex := strings.TrimSpace(os.Getenv("ENCRYPTION_KEY"))
	if keyHex == "" {
		return nil, errors.New("ENCRYPTION_KEY is not set")
	}

	key, err := hex.DecodeString(keyHex)
	if err != nil {
		return nil, fmt.Errorf("decode ENCRYPTION_KEY: %w", err)
	}
	if len(key) != 32 {
		return nil, errors.New("ENCRYPTION_KEY must be a 32-byte hex string")
	}
	return key, nil
}

// EncryptSecret encrypts plaintext with AES-256-GCM.
func EncryptSecret(plaintext string) (string, error) {
	key, err := encryptionKey()
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("create AEAD: %w", err)
	}

	iv := make([]byte, secretIVBytes)
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		return "", fmt.Errorf("read random IV: %w", err)
	}

	// GCM output = ciphertext || tag.
	sealed := aead.Seal(nil, iv, []byte(plaintext), nil)
	tagOffset := len(sealed) - aead.Overhead()
	ciphertext := sealed[:tagOffset]
	tag := sealed[tagOffset:]

	return base64.StdEncoding.EncodeToString(iv) + ":" +
		base64.StdEncoding.EncodeToString(ciphertext) + ":" +
		base64.StdEncoding.EncodeToString(tag), nil
}

// DecryptSecret decrypts payload produced by EncryptSecret.
func DecryptSecret(payload string) (string, error) {
	key, err := encryptionKey()
	if err != nil {
		return "", err
	}

	parts := strings.Split(payload, ":")
	if len(parts) != 3 {
		return "", errors.New("invalid encrypted payload format")
	}

	iv, err := base64.StdEncoding.DecodeString(parts[0])
	if err != nil {
		return "", fmt.Errorf("decode IV: %w", err)
	}
	ciphertext, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}
	tag, err := base64.StdEncoding.DecodeString(parts[2])
	if err != nil {
		return "", fmt.Errorf("decode tag: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("create AEAD: %w", err)
	}

	sealed := append(ciphertext, tag...)
	plaintext, err := aead.Open(nil, iv, sealed, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt secret: %w", err)
	}
	return string(plaintext), nil
}
