package main

import (
	"fmt"
	"log"
	"net/http"
)

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "Hello from AgentTeams API")
	})
	log.Println("API server listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
