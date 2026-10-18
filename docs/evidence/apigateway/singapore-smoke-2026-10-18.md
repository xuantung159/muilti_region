# API Gateway Singapore — smoke test

- Date: 2026-10-18 (Asia/Ho_Chi_Minh)
- API: REST API `mrapi-api-sg` (`43vakggyh5`)
- Stage: `demo`
- Endpoint: `GET https://43vakggyh5.execute-api.ap-southeast-1.amazonaws.com/demo/health`
- Test: one browser navigation plus nine reloads (10 requests total)
- Observed response body on all 10 requests:

```json
{"region":"ap-southeast-1","status":"ok"}
```

HTTP status was not captured by the browser accessibility snapshot. The endpoint rendered its JSON response successfully. This test confirms the deployed route responds; it does not verify CloudWatch metric aggregation.

## Proxy test from user's PowerShell output

The user-provided terminal result for `GET /proxy/{apiId}/anything?test=1` showed HTTP `200`, `X-Mrapi-Source: upstream`, and an httpbin JSON response echoing `test=1`. The API key is intentionally omitted from this evidence.

## Not tested

- CloudWatch `Count` reconciliation after metric publication delay.
- 10-request comparison against a second Region; `ap-northeast-1` has no API Gateway API in the account at the time of inspection.
