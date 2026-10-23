package main

import (
	"log"
	"net/http"
	"os"

	"example.com/invoicing/api/internal/billing"
	"example.com/invoicing/api/internal/middleware"
)

func main() {
	mux := http.NewServeMux()
	mux.Handle("GET /v1/invoices", middleware.RequireSession(http.HandlerFunc(billing.ListInvoices)))
	mux.HandleFunc("POST /v1/stripe/webhook", billing.StripeWebhook)

	addr := ":" + os.Getenv("PORT")
	log.Fatal(http.ListenAndServe(addr, mux))
}
