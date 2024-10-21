package activities

import (
	"bytes"
	"context"
	"log"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go/aws"
	"go.temporal.io/sdk/activity"
)

// TODO: Update all error handling cases
func getClient(ctx context.Context) (*s3.Client, error) {
	logger := activity.GetLogger(ctx)
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		logger.Error("Error from getClient:", err)
		return nil, err
	}
	return s3.NewFromConfig(cfg), nil
}

type CreateS3BucketInput struct {
	Bucket string
}

func CreateS3Bucket(ctx context.Context, input CreateS3BucketInput) error {
	logger := activity.GetLogger(ctx)
	s3Client, err := getClient(ctx)
	if err != nil {
		logger.Error("Error from getClient:", err)
		return err
	}
	_, err = s3Client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: &input.Bucket})
	if err != nil {
		log.Fatal("Error from CreateBucket:", err)
		return err
	}
	return nil
}

type PutS3ObjectInput struct {
	Body   []byte
	Bucket string
	Key    string
}

func putS3Object(ctx context.Context, input PutS3ObjectInput) error {
	logger := activity.GetLogger(ctx)
	s3Client, err := getClient(ctx)
	if err != nil {
		logger.Error("Error from getClient:", err)
		return err
	}
	_, err = s3Client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(input.Bucket),
		Key:    aws.String(input.Key),
		Body:   bytes.NewReader(input.Body),
	})
	if err != nil {
		log.Fatal("Error from s3Client.PutObject:", err)
		return err
	}
	return nil
}
