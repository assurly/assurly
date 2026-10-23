package middleware

import (
	"net/http"
	"strings"
)

// RequireSession rejects requests without a bearer token. Token verification
// is the part Assurly cannot read in Go, which is why this case exists.
func RequireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if token == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
