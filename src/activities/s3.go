package activities

import (
	"bytes"
	"context"
	"log"
	"os"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/s3"

	"go.temporal.io/sdk/activity"
)

var AWS_URL string = os.Getenv("AWS_URL")
var AWS_ACCESS_KEY_ID string = os.Getenv("AWS_ACCESS_KEY_ID")
var AWS_SECRET_ACCESS_KEY string = os.Getenv("AWS_SECRET_ACCESS_KEY")

// TODO: Update all error handling cases
func getClient(ctx context.Context) (*s3.S3, error) {
	logger := activity.GetLogger(ctx)
	sess, err := session.NewSession(&aws.Config{
		Region:           aws.String("us-east-1"),
		Credentials:      credentials.NewStaticCredentials(AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, ""),
		S3ForcePathStyle: aws.Bool(true),
		Endpoint:         aws.String(AWS_URL),
	})
	if err != nil {
		logger.Error("Error from getClient:", err)
		return nil, err
	}

	// Create S3 service client
	client := s3.New(sess)

	return client, nil
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
	_, err = s3Client.CreateBucket(&s3.CreateBucketInput{Bucket: &input.Bucket})
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
	_, err = s3Client.PutObject(&s3.PutObjectInput{
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

type GetS3ObjectInput struct {
	Bucket string
	Key    string
}

func GetS3Object(ctx context.Context, input GetS3ObjectInput) ([]byte, error) {
	s3Client, _ := getClient(ctx)
	resp, err := s3Client.GetObject(&s3.GetObjectInput{
		Bucket: aws.String(input.Bucket),
		Key:    aws.String(input.Key),
	})
	if err != nil {
		log.Fatal("Error from s3Client.GetS3Object:", err)
		return nil, err
	}
	defer resp.Body.Close()

	body := new(bytes.Buffer)
	_, err = body.ReadFrom(resp.Body)
	return body.Bytes(), err

}

type DeleteS3BucketInput struct {
	Bucket string
}

func DeleteS3Bucket(ctx context.Context, input DeleteS3BucketInput) (*s3.DeleteBucketOutput, error) {
	s3Client, _ := getClient(ctx)
	_, _ = s3Client.DeleteBucket(&s3.DeleteBucketInput{
		Bucket: aws.String(input.Bucket),
	})

	return nil, nil
}

type DeleteS3ObjectInput struct {
	Bucket string
	Key    string
}

func DeleteS3Object(ctx context.Context, input DeleteS3ObjectInput) (*s3.DeleteObjectOutput, error) {
	s3Client, _ := getClient(ctx)
	_, _ = s3Client.DeleteObject(&s3.DeleteObjectInput{
		Bucket: aws.String(input.Bucket),
		Key:    aws.String(input.Key),
	})

	return nil, nil
}
