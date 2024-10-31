package activities

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pgvector/pgvector-go"
	pgxvector "github.com/pgvector/pgvector-go/pgx"
)

func saveWorkflowId(ctx context.Context, workflowId string) error {
	conn, _ := GetConn(ctx)
	columns := []ColumnDefinition{
		{Name: "id", Type: "bigserial PRIMARY KEY"},
		{Name: "workflow_id", Type: "VARCHAR(255) NOT NULL"},
		{Name: "created_at", Type: "TIMESTAMPTZ DEFAULT NOW()"},
	}

	err := CreateTable(ctx, conn, "process_documents_workflow_ids", columns)
	if err != nil {
		return err
	}

	if err := SaveOnDatabase(ctx, conn, "process_documents_workflow_ids", []string{"workflow_id"}, workflowId); err != nil {
		return err
	}

	return nil
}

func getPGVectorStore(ctx context.Context) *pgx.Conn {
	conn, _ := GetConn(ctx)
	createExtension(ctx, conn, "vector")

	columns := []ColumnDefinition{
		{Name: "id", Type: "bigserial PRIMARY KEY"},
		{Name: "workflow_id", Type: "VARCHAR(255) NOT NULL"},
		{Name: "content", Type: "text"},
		{Name: "embedding", Type: "vector(1536)"},
	}
	err := CreateTable(ctx, conn, "documents", columns)
	if err != nil {
		log.Fatalf("Table creation failed: %v", err)
	}

	return conn
}

func GetConn(ctx context.Context) (*pgx.Conn, error) {
	conn, err := pgx.Connect(ctx, DATABASE_CONNECTION_STRING)
	if err != nil {
		return nil, err
	}
	return conn, nil
}

func createExtension(ctx context.Context, conn *pgx.Conn, name string) error {
	_, err := conn.Exec(ctx, "CREATE EXTENSION IF NOT EXISTS "+name)
	if err != nil {
		return err
	}

	err = pgxvector.RegisterTypes(ctx, conn)
	if err != nil {
		return err
	}
	return nil
}

func saveDocumentEmbedding(ctx context.Context, conn *pgx.Conn, content string, workflowId string) error {
	embeddings, err := FetchEmbeddings([]string{content})
	if err != nil {
		return err
	}
	err = SaveOnDatabase(ctx, conn, "documents", []string{"workflow_id", "content", "embedding"}, workflowId, content, pgvector.NewVector(embeddings))
	if err != nil {
		return err
	}

	return nil
}

type ProcessDocument struct {
	ID         int
	WorkflowID string
	CreatedAt  time.Time
}

func GetLatestDocumentProcessingId(ctx context.Context) (string, error) {
	conn, err := GetConn(ctx)
	if err != nil {
		return "", err
	}
	defer conn.Close(ctx)

	var doc ProcessDocument
	query := `
	SELECT id, workflow_id, created_at 
	FROM process_documents_workflow_ids
	ORDER BY created_at DESC 
	LIMIT 1;`

	err = conn.QueryRow(ctx, query).Scan(&doc.ID, &doc.WorkflowID, &doc.CreatedAt)
	if err != nil {
		return "", err
	}

	return doc.WorkflowID, nil
}

type Document struct {
	ID      int64
	Content string
}

func FetchEmbeddingsFromDatabase(ctx context.Context, conn *pgx.Conn, queryEmbedding []float32, latestDocumentProcessingId string) ([]Document, error) {
	query := "SELECT id, content FROM documents WHERE workflow_id =$1  ORDER BY embedding <=> $2 LIMIT 5"
	rows, err := conn.Query(ctx, query, latestDocumentProcessingId, pgvector.NewVector(queryEmbedding))
	if err != nil {
		return nil, err
	}

	defer rows.Close()

	var documents []Document

	for rows.Next() {
		var doc Document
		err = rows.Scan(&doc.ID, &doc.Content)
		if err != nil {
			return nil, err
		}
		documents = append(documents, doc)
	}

	if rows.Err() != nil {
		return nil, err
	}

	return documents, nil
}

func SaveOnDatabase(ctx context.Context, conn *pgx.Conn, table string, columns []string, values ...interface{}) error {
	colNames := strings.Join(columns, ", ")
	placeholders := make([]string, len(columns))
	for i := range placeholders {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
	}
	formattedValues := strings.Join(placeholders, ", ")
	query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s);", table, colNames, formattedValues)

	_, err := conn.Exec(ctx, query, values...)
	if err != nil {
		return err
	}

	return nil
}

type ColumnDefinition struct {
	Name string
	Type string
}

func CreateTable(ctx context.Context, conn *pgx.Conn, tableName string, columns []ColumnDefinition) error {
	columnDefs := make([]string, len(columns))
	for i, col := range columns {
		columnDefs[i] = fmt.Sprintf("%s %s", col.Name, col.Type)
	}
	columnStr := strings.Join(columnDefs, ", ")

	// Create the table
	query := fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s (%s);", tableName, columnStr)
	_, err := conn.Exec(ctx, query)
	if err != nil {
		return err
	}

	return nil
}
