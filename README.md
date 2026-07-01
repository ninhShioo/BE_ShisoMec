# Phenikaa Dental Backend

Backend của đồ án DOAN1, nằm độc lập trong thư mục `backend/`.

## Công nghệ

- Express 5
- MySQL/MariaDB qua `mysql2`
- Socket.IO realtime
- JWT authentication
- Cloudinary upload ảnh/tài liệu
- Migration/seed nhẹ qua `src/config/init_db.js`

## Cài đặt

```bash
cd backend
npm install
```

Tạo file `.env` từ `.env.example`:

```bash
copy .env.example .env
```

Các biến quan trọng:

- `PORT`: cổng backend, mặc định `8080`.
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT`: cấu hình MySQL.
- `JWT_SECRET`: khóa ký JWT, nên dài và riêng cho môi trường thật.
- `CORS_ORIGIN`: domain frontend được phép gọi API, ví dụ `http://localhost:5173`.
- `GOOGLE_CLIENT_ID`: OAuth Client ID cho đăng nhập Google.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`: dùng upload.
- `BACKEND_URL`, `FRONTEND_URL`: domain public dùng cho redirect/callback.
- `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`: thông tin merchant VNPay sandbox/production.
- `VNPAY_PAYMENT_URL`, `VNPAY_RETURN_URL`, `VNPAY_IPN_URL`: URL thanh toán và callback VNPay.

## Khởi tạo database

```bash
npm run db:setup
```

Lệnh này:

- Tạo database nếu chưa có.
- Tạo bảng từ `src/models/schema.sql`.
- Bổ sung các cột/index tương thích cho DB cũ.
- Seed dữ liệu demo.

## Chạy backend

```bash
npm run dev
```

Hoặc chạy production local:

```bash
npm start
```

Mặc định:

- Server: `http://localhost:8080`
- API: `http://localhost:8080/api`
- Health: `http://localhost:8080/health`

## Script hữu ích

```bash
npm run doctor
npm run smoke:api
npm run smoke:clean
npm run db:backup
```

- `doctor`: kiểm tra cấu hình/môi trường cơ bản.
- `smoke:api`: kiểm tra luồng API chính.
- `smoke:clean`: dọn dữ liệu smoke test.
- `db:backup`: backup MySQL vào `backend/backups/`.

## Tài khoản demo

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@doan1.local` | `Admin@123` |
| Staff | `staff@doan1.local` | `Staff@123` |
| Dentist | `dentist@doan1.local` | `Dentist@123` |
| Patient | `patient@doan1.local` | `Patient@123` |

## Module chính

- Auth: đăng nhập thường, Google login/register, đổi mật khẩu.
- Appointment: đặt lịch, slot bác sĩ, lọc lịch, dời lịch, timeline trạng thái.
- Schedule: lịch làm việc tuần, ngày nghỉ, yêu cầu nghỉ phép.
- Medical record: hồ sơ khám, vị trí răng, kế hoạch điều trị nhiều buổi.
- Invoice/payment: hóa đơn, chi tiết hóa đơn, lịch sử thanh toán.
- VNPay: tạo link thanh toán, nhận return/IPN, tự ghi nhận payment.
- Notification: realtime Socket.IO, lịch sử thông báo theo loại.
- Chat: hộp chat khách hàng/nhân viên.

## Tài liệu

- `docs/api-reference.md`
- `docs/demo-checklist.md`
- `docs/deployment-notes.md`
- `docs/backend-smoke-test.md`
