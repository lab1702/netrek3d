# Build stage
FROM golang:1.26-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
# web/ assets are embedded into the binary via go:embed
RUN CGO_ENABLED=0 GOOS=linux go build -o netrek3d .

# Final stage
FROM alpine:3.21

RUN addgroup -S netrek && adduser -S netrek -G netrek

WORKDIR /home/netrek

COPY --from=builder /app/netrek3d .

USER netrek

EXPOSE 9701

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:9701/health || exit 1

CMD ["./netrek3d"]
