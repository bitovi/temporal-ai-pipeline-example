import { S3Client, GetObjectCommand, PutObjectCommand, CreateBucketCommand } from '@aws-sdk/client-s3';

const S3 = new S3Client({ region: 'us-east-1', endpoint: 'http://0.0.0.0:4566', credentials: {
  accessKeyId: 'test',
  secretAccessKey: 'test'
}});

async function init(){
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
