# Backend giám sát — chưa triển khai

Viết Lambda tại đây khi tích hợp dữ liệu AWS thật. Không có handler giả trả dữ liệu mẫu.

Contract: [backend-api.md](../../monitoring-web/docs/integration/backend-api.md).
Frontend: [monitoring-web](../../monitoring-web/README.md).

Khi có `index.mjs`, script đóng gói sẽ tạo ZIP với handler `monitoring/index.handler`. Bổ sung IAM role, biến môi trường và route trước khi triển khai.
