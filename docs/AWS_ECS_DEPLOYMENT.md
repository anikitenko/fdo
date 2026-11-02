# Deploy an exported FDO plugin to AWS ECS Fargate

Start in the extracted standalone export folder. This reference uses ECR for the image, ECS Fargate for the application, Secrets Manager for `.env` values, EFS for `/data`, and an HTTPS Application Load Balancer (ALB). Exporting and opening this guide do not create cloud resources; the commands do when you run them.

## 1. Prepare AWS access, networking and HTTPS

Install AWS CLI v2, Docker with Buildx, and Node.js 24+. Configure your AWS CLI profile/SSO before starting. Your deployment account needs ECR/ECS/EFS/EC2/ELB/CloudWatch/Secrets Manager permissions and permission to create/pass the IAM roles below.

Use two **public subnets in different availability zones in one VPC**, with a route to an internet gateway and VPC DNS enabled. This compact reference gives the task a public IP for outbound image/API access; its security group accepts application traffic only from the ALB. For private tasks instead, supply private subnets plus NAT or the required VPC endpoints and outbound access for the plugin's APIs.

Supply an issued ACM certificate in the same region covering a DNS name you control. Point that name to the ALB after step 6. Do not use the ALB's AWS hostname as a substitute for a certificate covering your own hostname.

```bash
AWS_REGION="eu-west-1"
APP="fdo-hyperstack"
CLUSTER="fdo-plugins"
IMAGE_TAG="1.0"
VPC_ID="vpc-REPLACE"
SUBNET_A="subnet-REPLACE-A"
SUBNET_B="subnet-REPLACE-B"
APP_HOST="fdo.example.com"
CERT_ARN="arn:aws:acm:eu-west-1:ACCOUNT:certificate/REPLACE"
export AWS_REGION APP CLUSTER IMAGE_TAG VPC_ID SUBNET_A SUBNET_B APP_HOST

aws sts get-caller-identity
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ECR_SERVER="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
export ACCOUNT_ID ECR_SERVER
node setup.cjs
PORT="$(node -e "const fs=require('node:fs'); const e=require('node:util').parseEnv(fs.readFileSync('.env','utf8')); console.log(e.PORT||8080)")"
export PORT
```

Replace all `REPLACE` inputs before executing cloud commands. Reuse the export's selected port. Preserve `WEB_APP_SECRET_KEY` when reusing an existing encrypted vault. This reference creates billable registry, compute, storage and load-balancer resources.

## 2. Build and push the image

```bash
aws ecr create-repository --repository-name "$APP" \
  --image-scanning-configuration scanOnPush=true
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_SERVER"
docker buildx build --platform linux/amd64 \
  --tag "$ECR_SERVER/$APP:$IMAGE_TAG" --push .
aws ecs create-cluster --cluster-name "$CLUSTER"
aws logs create-log-group --log-group-name "/ecs/$APP"
aws logs put-retention-policy --log-group-name "/ecs/$APP" --retention-in-days 30
```

The image's `.dockerignore` excludes `.env` and `deployment/*.private.json`. Supply provider credentials at runtime, not in image layers. Add any required `deployment/services.json` secret-name mappings before this build.

## 3. Configure task and storage security groups

```bash
ALB_SG="$(aws ec2 create-security-group --group-name "$APP-alb" \
  --description 'FDO HTTPS ingress' --vpc-id "$VPC_ID" --query GroupId --output text)"
TASK_SG="$(aws ec2 create-security-group --group-name "$APP-task" \
  --description 'FDO application from ALB only' --vpc-id "$VPC_ID" --query GroupId --output text)"
EFS_SG="$(aws ec2 create-security-group --group-name "$APP-efs" \
  --description 'FDO NFS from application only' --vpc-id "$VPC_ID" --query GroupId --output text)"

aws ec2 authorize-security-group-ingress --group-id "$ALB_SG" \
  --protocol tcp --port 443 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$TASK_SG" \
  --protocol tcp --port "$PORT" --source-group "$ALB_SG"
aws ec2 authorize-security-group-ingress --group-id "$EFS_SG" \
  --protocol tcp --port 2049 --source-group "$TASK_SG"
export ALB_SG TASK_SG EFS_SG
```

Review outbound rules for your environment. The new groups' default outbound rules permit registry, secret retrieval and provider HTTPS access. Do not expose the task port or NFS to the internet.

## 4. Create EFS and a UID 1000 access point

```bash
EFS_ID="$(aws efs create-file-system --encrypted \
  --creation-token "$APP-data" --tags Key=Name,Value="$APP-data" \
  --query FileSystemId --output text)"
until [ "$(aws efs describe-file-systems --file-system-id "$EFS_ID" \
  --query 'FileSystems[0].LifeCycleState' --output text)" = "available" ]; do sleep 5; done

aws efs create-mount-target --file-system-id "$EFS_ID" \
  --subnet-id "$SUBNET_A" --security-groups "$EFS_SG"
aws efs create-mount-target --file-system-id "$EFS_ID" \
  --subnet-id "$SUBNET_B" --security-groups "$EFS_SG"
until [ "$(aws efs describe-mount-targets --file-system-id "$EFS_ID" \
  --query "length(MountTargets[?LifeCycleState!='available'])" --output text)" = "0" ]; do sleep 5; done

EFS_AP="$(aws efs create-access-point --file-system-id "$EFS_ID" \
  --posix-user Uid=1000,Gid=1000 \
  --root-directory 'Path=/fdo,CreationInfo={OwnerUid=1000,OwnerGid=1000,Permissions=0700}' \
  --query AccessPointId --output text)"
export EFS_ID EFS_AP
```

The access point supplies the writable directory ownership expected by the non-root image. The task definition will use IAM authorization and in-transit encryption. Keep one writer on this file-based vault and back up EFS plus the encryption key separately.

## 5. Import `.env` into Secrets Manager and create IAM roles

Create a private JSON secret payload without printing values or evaluating `.env` as shell code:

```bash
node <<'NODE'
const fs=require('node:fs');
const values=require('node:util').parseEnv(fs.readFileSync('.env','utf8'));
if (!values.WEB_APP_USERNAME || (values.WEB_APP_PASSWORD||'').length<24 ||
    Buffer.from(values.WEB_APP_SECRET_KEY||'','base64').length!==32) throw new Error('Run setup.cjs first.');
delete values.PORT; delete values.WEB_APP_ORIGIN;
fs.writeFileSync('deployment/ecs-env.private.json',JSON.stringify(values),{mode:0o600});
fs.chmodSync('deployment/ecs-env.private.json',0o600);
NODE

SECRET_ARN="$(aws secretsmanager create-secret --name "$APP/environment" \
  --secret-string file://deployment/ecs-env.private.json --query ARN --output text)"
export SECRET_ARN

node <<'NODE'
const fs=require('node:fs'),e=process.env;
const write=(file,data)=>fs.writeFileSync('deployment/'+file,JSON.stringify(data,null,2)+'\n');
write('ecs-trust.json',{Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Service:'ecs-tasks.amazonaws.com'},Action:'sts:AssumeRole',Condition:{StringEquals:{'aws:SourceAccount':e.ACCOUNT_ID},ArnLike:{'aws:SourceArn':`arn:aws:ecs:${e.AWS_REGION}:${e.ACCOUNT_ID}:*`}}}]});
write('ecs-secret-policy.json',{Version:'2012-10-17',Statement:[{Effect:'Allow',Action:['secretsmanager:GetSecretValue'],Resource:e.SECRET_ARN}]});
write('ecs-efs-policy.json',{Version:'2012-10-17',Statement:[{Effect:'Allow',Action:['elasticfilesystem:ClientMount','elasticfilesystem:ClientWrite'],Resource:`arn:aws:elasticfilesystem:${e.AWS_REGION}:${e.ACCOUNT_ID}:file-system/${e.EFS_ID}`,Condition:{StringEquals:{'elasticfilesystem:AccessPointArn':`arn:aws:elasticfilesystem:${e.AWS_REGION}:${e.ACCOUNT_ID}:access-point/${e.EFS_AP}`}}}]});
NODE

aws iam create-role --role-name "$APP-execution" \
  --assume-role-policy-document file://deployment/ecs-trust.json
aws iam attach-role-policy --role-name "$APP-execution" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam put-role-policy --role-name "$APP-execution" --policy-name fdo-secrets \
  --policy-document file://deployment/ecs-secret-policy.json
aws iam create-role --role-name "$APP-runtime" \
  --assume-role-policy-document file://deployment/ecs-trust.json
aws iam put-role-policy --role-name "$APP-runtime" --policy-name fdo-efs \
  --policy-document file://deployment/ecs-efs-policy.json
```

The **execution role** retrieves the image, startup secrets and logs. The **task role** authorizes EFS and any separately approved AWS operations performed by the plugin. Add only the application permissions it actually needs. If using a customer-managed KMS key for secrets, add the necessary scoped decrypt permission. Allow IAM changes to propagate before starting tasks.

## 6. Create the HTTPS load balancer

```bash
ALB_ARN="$(aws elbv2 create-load-balancer --name "$APP-alb" \
  --subnets "$SUBNET_A" "$SUBNET_B" --security-groups "$ALB_SG" \
  --scheme internet-facing --type application \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)"
TG_ARN="$(aws elbv2 create-target-group --name "$APP-http" \
  --protocol HTTP --port "$PORT" --vpc-id "$VPC_ID" --target-type ip \
  --health-check-path /health/ready --matcher HttpCode=200 \
  --query 'TargetGroups[0].TargetGroupArn' --output text)"
aws elbv2 wait load-balancer-available --load-balancer-arns "$ALB_ARN"
aws elbv2 create-listener --load-balancer-arn "$ALB_ARN" \
  --protocol HTTPS --port 443 --certificates CertificateArn="$CERT_ARN" \
  --default-actions Type=forward,TargetGroupArn="$TG_ARN"
aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" \
  --query 'LoadBalancers[0].DNSName' --output text
export TG_ARN
```

Point `APP_HOST` to this ALB using your DNS provider (or a Route 53 alias). Verify that ACM covers `APP_HOST`. The task listens on the selected container port; the public application origin is `https://APP_HOST` on 443.

## 7. Generate and register the task definition

```bash
node <<'NODE'
const fs=require('node:fs'),e=process.env;
for(const k of ['APP','AWS_REGION','ACCOUNT_ID','ECR_SERVER','IMAGE_TAG','APP_HOST','SECRET_ARN','EFS_ID','EFS_AP','PORT']) if(!e[k]) throw new Error('Missing '+k);
const env=require('node:util').parseEnv(fs.readFileSync('.env','utf8'));
if(!Number.isInteger(Number(e.PORT)) || Number(e.PORT)<1024 || Number(e.PORT)>65535) throw new Error('Invalid port');
const task=JSON.parse(fs.readFileSync('deployment/aws-ecs.task.json','utf8'));
task.family=e.APP;task.cpu='512';task.memory='1024';
task.executionRoleArn=`arn:aws:iam::${e.ACCOUNT_ID}:role/${e.APP}-execution`;
task.taskRoleArn=`arn:aws:iam::${e.ACCOUNT_ID}:role/${e.APP}-runtime`;
const c=task.containerDefinitions[0];c.name='application';c.image=`${e.ECR_SERVER}/${e.APP}:${e.IMAGE_TAG}`;
c.portMappings=[{containerPort:Number(e.PORT),protocol:'tcp'}];
c.environment=[{name:'PORT',value:e.PORT},{name:'WEB_APP_ORIGIN',value:'https://'+e.APP_HOST}];
c.secrets=Object.keys(env).filter(k=>!['PORT','WEB_APP_ORIGIN'].includes(k)).map(name=>({name,valueFrom:e.SECRET_ARN+':'+name+'::'}));
c.mountPoints=[{sourceVolume:'application-data',containerPath:'/data',readOnly:false}];
c.logConfiguration={logDriver:'awslogs',options:{'awslogs-group':'/ecs/'+e.APP,'awslogs-region':e.AWS_REGION,'awslogs-stream-prefix':'application'}};
task.volumes=[{name:'application-data',efsVolumeConfiguration:{fileSystemId:e.EFS_ID,transitEncryption:'ENABLED',authorizationConfig:{accessPointId:e.EFS_AP,iam:'ENABLED'}}}];
fs.writeFileSync('deployment/ecs-task.private.json',JSON.stringify(task,null,2)+'\n',{mode:0o600});
fs.chmodSync('deployment/ecs-task.private.json',0o600);
console.log('Task definition prepared; secret values were not printed.');
NODE

TASK_ARN="$(aws ecs register-task-definition \
  --cli-input-json file://deployment/ecs-task.private.json \
  --query taskDefinition.taskDefinitionArn --output text)"
```

The task uses secret **references**, not plaintext values. Pin the encryption key's secret version for durable production use; do not rotate it without re-encrypting the vault. This first-deployment reference uses the current secret version, so retain it unchanged for updates. Fargate Linux platform `1.4.0` or later is required for JSON-key secret selectors and EFS.

## 8. Start and verify the service

```bash
aws ecs create-service --cluster "$CLUSTER" --service-name "$APP" \
  --task-definition "$TASK_ARN" --launch-type FARGATE --platform-version 1.4.0 \
  --desired-count 1 \
  --deployment-configuration maximumPercent=100,minimumHealthyPercent=0 \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_A,$SUBNET_B],securityGroups=[$TASK_SG],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=$TG_ARN,containerName=application,containerPort=$PORT" \
  --health-check-grace-period-seconds 120
aws ecs wait services-stable --cluster "$CLUSTER" --services "$APP"
aws elbv2 describe-target-health --target-group-arn "$TG_ARN"
aws logs tail "/ecs/$APP" --follow
```

Open your HTTPS hostname and sign in using `.env`. `/health/ready` is public for the ALB; application routes still require the app's sign-in. Check ECS stopped-task reasons if startup fails: image permissions, Secrets Manager permissions, EFS mount targets/2049, UID 1000, and the configured port are common causes.

## Updating, authentication and storage boundaries

This export uses file-based state: one writer, one replica. For a planned update, capture the running task ARNs, set desired count to zero, and wait for those tasks to stop before deploying a new writer. This intentionally creates a maintenance window.

```bash
OLD_TASKS="$(aws ecs list-tasks --cluster "$CLUSTER" --service-name "$APP" \
  --desired-status RUNNING --query taskArns --output text)"
aws ecs update-service --cluster "$CLUSTER" --service "$APP" --desired-count 0
if [ -n "$OLD_TASKS" ] && [ "$OLD_TASKS" != "None" ]; then
  aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks $OLD_TASKS
fi
# Build a new image tag, regenerate/register the task definition, and update TASK_ARN.
aws ecs update-service --cluster "$CLUSTER" --service "$APP" \
  --task-definition "$TASK_ARN" --desired-count 1
aws ecs wait services-stable --cluster "$CLUSTER" --services "$APP"
```

Keep EFS and the same vault encryption key. A secret update does not change an already running task's environment; replace the task after updating the appropriate secret references. Do not scale this file-based vault out without a transactional persistence design or explicit writer coordination.

An AWS CLI inside the plugin can use the task role when its credential provider can access the ECS credential endpoint. FDO's process scopes must permit the required credential-provider environment keys, such as `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`; installing `aws` is not a permission grant. Azure CLI in ECS needs its own noninteractive identity configuration. Never copy desktop CLI caches into the image.

## References

- [Fargate and EFS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/efs-volumes.html)
- [EFS security and access points](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/efs-best-practices.html)
- [Secrets Manager values in task environments](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)
- [Task roles](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html)
- [ECS create-service options](https://docs.aws.amazon.com/cli/latest/reference/ecs/create-service.html)
- [Application Load Balancer target groups](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html)
