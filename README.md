# Phenikaa Dental - DOAN1

Ứng dụng quản lý và đặt lịch nha khoa gồm backend Express/MySQL và frontend React/Vite.

## Yêu cầu

- Node.js 18+
- MySQL 8+ hoặc MariaDB tương thích
- Tài khoản Cloudinary nếu dùng upload ảnh/tài liệu

## Cài đặt

```bash
npm install
cd frontend
npm install
cd ..
```

Tạo file `.env` từ `.env.example` và điền cấu hình thật:

```bash
copy .env.example .env
```

Nếu cần cấu hình frontend riêng, tạo `frontend/.env` từ `frontend/.env.example`.

## Khởi tạo dữ liệu

```bash
npm run db:setup
```

Lệnh này tạo bảng, bổ sung migration nhẹ và seed dữ liệu demo. Có thể chạy lại nhiều lần, không reset dữ liệu.

## Chạy dự án

Backend:

```bash
npm run dev
```

Frontend:

```bash
cd frontend
npm run dev
```

Mặc định:

- Backend: `http://localhost:8080`
- API: `http://localhost:8080/api`
- Frontend: `http://localhost:5173`
- Health check: `http://localhost:8080/health`

## Kiểm tra nhanh

Kiểm tra môi trường:

```bash
npm run doctor
```

Kiểm tra luồng API chính:

```bash
npm run smoke:api
```

Kiểm tra health endpoint:

```bash
curl http://localhost:8080/health
```

Build frontend:

```bash
cd frontend
npm run build
```

## Tài khoản demo

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@doan1.local` | `Admin@123` |
| Staff | `staff@doan1.local` | `Staff@123` |
| Dentist | `dentist@doan1.local` | `Dentist@123` |
| Patient | `patient@doan1.local` | `Patient@123` |

## Cấu hình deploy

- `PORT`: cổng backend.
- `JWT_SECRET`: khóa ký JWT, nên dài ít nhất 32 ký tự.
- `CORS_ORIGIN`: domain frontend được phép gọi API, có thể nhập nhiều domain bằng dấu phẩy.
- `BODY_LIMIT`: giới hạn JSON/form body, mặc định `1mb`.
- `RATE_LIMIT_WINDOW_MS`: khung thời gian rate limit.
- `RATE_LIMIT_MAX`: số request tối đa trong khung thời gian.
- `VITE_API_URL`: URL API cho frontend.
- `VITE_SOCKET_URL`: URL socket cho frontend.

## Luồng nghiệp vụ chính

1. Patient đặt lịch với dịch vụ.
2. Staff/Admin phân công bác sĩ.
3. Staff/Admin xác nhận lịch.
4. Dentist tạo hồ sơ khám, hệ thống chuyển lịch sang hoàn thành.
5. Staff/Admin xuất hóa đơn.
6. Staff/Admin thanh toán hóa đơn.
7. Patient xem hóa đơn và hồ sơ của mình.

## Tài liệu liên quan

- [Backend smoke test](docs/backend-smoke-test.md)
- [Demo checklist](docs/demo-checklist.md)
- [API reference](docs/api-reference.md)
- [Deployment notes](docs/deployment-notes.md)
