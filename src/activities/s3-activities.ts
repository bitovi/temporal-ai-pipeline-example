import {
  S3Client,
  S3ClientConfig,
  GetObjectCommand,
  GetObjectCommandOutput,
  PutObjectCommand,
  PutObjectCommandOutput,
  DeleteObjectCommand,
  DeleteObjectCommandOutput,
  CreateBucketCommand,
  CreateBucketCommandOutput,
  DeleteBucketCommand,
  DeleteBucketCommandOutput
} from '@aws-sdk/client-s3' 

const AWS_URL = process.env.AWS_URL
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY

let _s3Client: S3Client
function getClient(): S3Client { 
  console.log('Getting S3 client.');
  if(!_s3Client) {
    const s3ClientOptions: S3ClientConfig = {
      region: 'us-east-1',
      endpoint: AWS_URL,
      forcePathStyle: true
    }

    if (AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY) {
      s3ClientOptions.credentials = {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY
      }
    }
    _s3Client = new S3Client(s3ClientOptions)
  }

  console.log('Success on getting S3 client.');
  return _s3Client
}

type CreateS3BucketInput = {
  bucket: string
}
export async function createS3Bucket(input: CreateS3BucketInput): Promise<CreateBucketCommandOutput> {
  const { bucket } = input
  const s3Client = getClient()

  
  console.log(`Creating S3 bucket ${bucket}.`);
  return s3Client.send(new CreateBucketCommand({ Bucket: bucket }))
}

type DeleteS3BucketInput = {
  bucket: string
}
export async function deleteS3Bucket(input: DeleteS3BucketInput): Promise<DeleteBucketCommandOutput> {
  const { bucket } = input
  const s3Client = getClient()

  console.log(`Getting S3 bucket ${bucket}.`);
  return s3Client.send(new DeleteBucketCommand({ Bucket: bucket }))
}

type GetS3ObjectInput = {
  bucket: string
  key: string
}
export async function getS3Object(input: GetS3ObjectInput): Promise<GetObjectCommandOutput> {
  const { bucket, key } = input
  const s3Client = getClient()

  console.log(`Getting S3 object ${input.key} from bucket ${input.bucket}`);
  return s3Client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  )
}

type PutS3ObjectInput = {
  body: Buffer
  bucket: string
  key: string
}
export async function putS3Object(input: PutS3ObjectInput): Promise<PutObjectCommandOutput> {
  const { body, bucket, key } = input
  const s3Client = getClient()

  console.log(`Uploading ${key} to S3 bucket.`);
  return s3Client.send(
    new PutObjectCommand({
      Body: body,
      Bucket: bucket,
      Key: key
    })
  )
}

type DeleteS3ObjectInput = {
  bucket: string
  key: string
}
export async function deleteS3Object(input: DeleteS3ObjectInput): Promise<DeleteObjectCommandOutput> {
  const { bucket, key } = input
  const s3Client = getClient()

  console.log('Deleting object from S3 bucket.');
  return s3Client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key
    })
  )
}