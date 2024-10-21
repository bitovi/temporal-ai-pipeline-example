FROM golang:1.23

WORKDIR /usr/src/app

COPY go.mod go.mod 
COPY src src 

RUN go mod tidy

WORKDIR "/src/process-documents-worker"

CMD ["air"]
