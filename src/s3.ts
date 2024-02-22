import { S3Client, S3ClientConfig, GetObjectCommand, PutObjectCommand, CreateBucketCommand } from '@aws-sdk/client-s3';

const AWS_URL = process.env.AWS_URL
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY

const s3ClientOptions: S3ClientConfig = {
  region: 'us-east-1',
  endpoint: AWS_URL,
}

if (AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY) {
  s3ClientOptions.credentials = {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY
  }
}

const S3 = new S3Client(s3ClientOptions);

async function init() {
  try {
    const response = await createS3Bucket('training');
    console.log('create bucket response:', response);
  } catch(err) {
    console.log('ERROR creating bucket',err)
  }
}
init().catch(console.log);


export async function createS3Bucket(bucket: string): Promise<any> {
  const response = S3.send(new CreateBucketCommand({ Bucket: bucket }));
  return response;
}

export async function getS3Object(bucket: string, key: string): Promise<any> {
  const response = await S3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
  return response;
}

export async function putS3Object(body: any, bucket: string, key: string): Promise<any> {
  const response = await S3.send(
    new PutObjectCommand({
      Body: body,
      Bucket: bucket,
      Key: key,
      ContentType: 'text/csv',
    })
  );
  return response;
}
