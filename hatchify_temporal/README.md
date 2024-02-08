# Temporal AI workflow

The following is a simplified sample Temporal workflow to create custom embeddings from large list of files.


### Installing and runing dependencies

#### S3 / LocalStack

We need S3, you can use S3 or a local dev version, in our case we picked LocalStack: You can start LocalStack with Docker Compose by configuring a `docker-compose.yml` file.

```yaml
version: "3.8"

services:
  localstack:
    container_name: "${LOCALSTACK_DOCKER_NAME:-localstack-main}"
    image: localstack/localstack:s3-latest
    ports:
      - "127.0.0.1:4566:4566"            # LocalStack Gateway
    environment:
      - DEBUG=${DEBUG:-0}
    volumes:
      - "${LOCALSTACK_VOLUME_DIR:-./volume}:/var/lib/localstack"
      - "/var/run/docker.sock:/var/run/docker.sock"
```

Start the container by running the following command:

```bash
docker-compose up
```

To connect to the local S3 instance you need to add the following to an `.env` file.

```yaml
AWS_ACCESS_KEY_ID = "test"
AWS_SECRET_ACCESS_KEY = "test"
```

### Run temporal in Docker

You can run Temporal using CLI command or docker, in our example we will use docker

Steps to Run a Temporal Cluster:
Clone the temporalio/docker-compose repository:
```bash
git clone https://github.com/temporalio/docker-compose.git
```
Navigate to the root directory of the cloned repository:
```bash
cd docker-compose
```
Start the Temporal Cluster using Docker Compose:
```bash
docker compose up
```
### Postgrsql

Add to the .env file the following

```yaml
PGHOST=your database host
PGUSER=your database user
PGPASSWORD=your database password
PGDATABASE=your database name
PGPORT=your database port
```

```yaml
version: '3.1'

services:

  postgres:
    container_name: vector_db
    image: ankane/pgvector
    command: postgres -c 'max_connections=200'
    ports:
      - 5432:5432
    restart: always
    environment:
       - POSTGRES_HOST_AUTH_METHOD=trust
       - POSTGRES_PASSWORD=mypass
       - POSTGRES_USER=dbuser
       - POSTGRES_DB=hatchDB
    volumes:
      - ./db.sql:/docker-entrypoint-initdb.d/db.sql
```



### OpenAI API KEY

You need an OpenAI API KEY that you can get from [link]

### Running the code
1. `cd hatchify_temporal` to be in the main project folder.
1. `npm install` to install dependencies.
1. `npm run start.watch` to start the Worker. (You can start multiple in separate shells)
1. In another shell, `npm run workflow` to run the Workflow Client.

make sure the `.env` file looks like this

```yaml
AWS_ACCESS_KEY_ID = test
AWS_SECRET_ACCESS_KEY = test
OPENAI_API_KEY = PUT_YOUR_KEY_HERE

PGHOST = localhost
PGUSER = dbuser
PGPASSWORD = mypass
PGDATABASE = hatchDB
PGPORT = 5432
```


## NOTES 

stored indexes and embeddings in DB , refer to a certain location of collections, when the chat engine need to be used, it should have access to those locations, to be able to read and "embedd" the relevant parts in the request to the LLM
![Alt text](image.png)