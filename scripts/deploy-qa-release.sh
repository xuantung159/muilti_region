#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export AWS_PAGER=""
account=$(aws sts get-caller-identity --query Account --output text)
[[ "$account" == "138150704839" ]] || { echo "Wrong AWS account"; exit 1; }
release_hash=$(openssl dgst -sha256 -binary monitoring.zip | openssl base64 -A)
backup="$HOME/mrapi-qa-backup-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup"
aws s3 cp s3://mrapi-web-sg/index.html "$backup/index.html" --region ap-southeast-1
for region in ap-southeast-1 ap-northeast-1; do
  revision=$(aws lambda get-function-configuration --function-name mrapi-monitoring --region "$region" --query RevisionId --output text)
  old_hash=$(aws lambda get-function-configuration --function-name mrapi-monitoring --region "$region" --query CodeSha256 --output text)
  if [[ "$old_hash" != "$release_hash" ]]; then
    location=$(aws lambda get-function --function-name mrapi-monitoring --region "$region" --query Code.Location --output text)
    curl --fail --silent --show-error "$location" -o "$backup/monitoring-$region.zip"
    aws lambda update-function-code --function-name mrapi-monitoring --region "$region" --revision-id "$revision" --zip-file fileb://monitoring.zip --query '{CodeSha256:CodeSha256,LastUpdateStatus:LastUpdateStatus}'
    aws lambda wait function-updated-v2 --function-name mrapi-monitoring --region "$region"
  fi
  actual=$(aws lambda get-function-configuration --function-name mrapi-monitoring --region "$region" --query CodeSha256 --output text)
  [[ "$actual" == "$release_hash" ]] || { echo "Hash mismatch $region"; exit 1; }
  echo "VERIFIED monitoring $region $actual"
done
aws s3 cp dist/ s3://mrapi-web-sg/ --recursive --exclude index.html --region ap-southeast-1 --only-show-errors
aws s3 cp dist/index.html s3://mrapi-web-sg/index.html --cache-control no-cache --content-type text/html --region ap-southeast-1 --only-show-errors
invalidation=$(aws cloudfront create-invalidation --distribution-id E33WCNP66CDRPQ --paths '/*' --query Invalidation.Id --output text)
echo "INVALIDATION $invalidation"
echo "BACKUP $backup"
echo "RELEASE_UPLOADED"
aws cloudfront wait invalidation-completed --distribution-id E33WCNP66CDRPQ --id "$invalidation"
echo "DEPLOY_COMPLETE"
