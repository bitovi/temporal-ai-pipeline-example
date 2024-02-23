import { S3Client, S3ClientConfig, GetObjectCommand, PutObjectCommand, CreateBucketCommand, DeleteBucketCommand } from '@aws-sdk/client-s3'

const AWS_URL = process.env.AWS_URL
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY

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

let _s3Client: S3Client
function getClient(): S3Client {
  if(!_s3Client) {
    _s3Client = new S3Client(s3ClientOptions)
  }

  return _s3Client
}

type CreateS3BucketInput = {
  bucket: string
}
export async function createS3Bucket(input: CreateS3BucketInput): Promise<any> {
  const { bucket } = input
  const s3Client = getClient()
  const response = s3Client.send(new CreateBucketCommand({ Bucket: bucket }))
  return response
}

type DeleteS3BucketInput = {
  bucket: string
}
export async function deleteS3Bucket(input: DeleteS3BucketInput): Promise<any> {
  const { bucket } = input
  const s3Client = getClient()
  const response = s3Client.send(new DeleteBucketCommand({ Bucket: bucket }))
  return response
}

type GetS3ObjectInput = {
  bucket: string
  key: string
}
export async function getS3Object(input: GetS3ObjectInput): Promise<any> {
  const { bucket, key } = input
  const s3Client = getClient()
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  )
  return response
}

type PutS3ObjectInput = {
  body: Buffer
  bucket: string
  key: string
}
export async function putS3Object(input: PutS3ObjectInput): Promise<any> {
  const { body, bucket, key } = input
  const s3Client = getClient()
  const response = await s3Client.send(
    new PutObjectCommand({
      Body: body,
      Bucket: bucket,
      Key: key,
      ContentType: 'text/csv',
    })
  )
  return response
}
