# API Reference

Base URL mặc định:

```text
http://localhost:8080/api
```

Các API protected dùng header:

```http
Authorization: Bearer <token>
```

## Auth

| Method | Endpoint | Role | Mô tả |
| --- | --- | --- | --- |
| POST | `/auth/register` | Public | Đăng ký tài khoản patient |
| POST | `/auth/login` | Public | Đăng nhập |
| GET | `/auth/me` | Authenticated | Lấy thông tin user hiện tại |

## Users

| Method | Endpoint | Role | Mô tả |
| --- | --- | --- | --- |
| GET | `/users/public/dentists` | Public | Danh sách bác sĩ active |
| GET | `/users` | Admin, Staff, Dentist | Danh sách user theo quyền |
| POST | `/users/staff` | Admin | Tạo admin/staff/dentist |
| PUT | `/users/:id/status` | Admin | Khóa/mở tài khoản |
| PUT | `/users/:id/reset-password` | Admin | Reset mật khẩu |
| PUT | `/users/:id` | Owner hoặc Admin | Cập nhật hồ sơ |

## Services

| Method | Endpoint | Role | Mô tả |
| --- | --- | --- | --- |
| GET | `/services` | Public | Danh sách dịch vụ active |
| GET | `/services/:id` | Public | Chi tiết dịch vụ active |
| GET | `/services/manage/all` | Admin | Danh sách dịch vụ quản trị |
| GET | `/services/usage/stats` | Admin | Thống kê lượt dùng dịch vụ |
| POST | `/services` | Admin | Tạo dịch vụ |
| PUT | `/services/:id` | Admin | Cập nhật dịch vụ |
| DELETE | `/services/:id` | Admin | Ẩn dịch vụ |

## Categories

| Method | Endpoint | Role | Mô tả |
| --- | --- | --- | --- |
| GET | `/categories` | Public | Danh sách danh mục |
| POST | `/categories` | Admin | Tạo danh mục |
| PUT | `/categories/:id` | Admin | Cập nhật danh mục |
| DELETE | `/categories/:id` | Admin | Xóa danh mục |

## Appointments

| Method | Endpoint | Role | Mô tả |
| --- | --- | --- | --- |
| POST | `/appointments` | Patient, Admin, Staff | Tạo lịch hẹn |
| GET | `/appointments` | Patient, Dentist, Admin, Staff | Danh sách lịch theo quyền |
| PUT | `/appointments/:id/assign` | Admin, Staff | Phân công bác sĩ |
| PUT | `/appointments/:id/status` | Patient, Admin, Staff | Hủy/xác nhận lịch theo quyền |

Luồng trạng thái chính:

```text
pending -> confirmed -> completed
pending/confirmed -> cancelled
```

`completed` được tạo khi dentist/admin lưu hồ sơ khám.

## Medical Records

| Method | Endpoint | Role | Mô tả |
| --- | --- | --- | --- |
| POST | `/records` | Dentist, Admin | Tạo hồ sơ khám |
| GET | `/records/patient/:patientId` | Patient, Dentist, Admin, Staff | Xem hồ sơ theo quyền |

## Invoices

| Method | Endpoint | Role | Mô tả |
| --- | --- | --- | --- |
| POST | `/invoices` | Admin, Staff | Xuất hóa đơn cho lịch completed |
| GET | `/invoices` | Patient, Admin, Staff | Danh sách hóa đơn theo quyền |
| PUT | `/invoices/:id/pay` | Admin, Staff | Thanh toán hóa đơn |

## Promotions

| Method | Endpoint | Role | Mô tả |
| --- | --- | --- | --- |
| GET | `/promotions/active` | Public | Khuyến mãi đang hoạt động |
| GET | `/promotions` | Admin | Danh sách khuyến mãi |
| POST | `/promotions` | Admin | Tạo khuyến mãi |
| PUT | `/promotions/:id` | Admin | Cập nhật khuyến mãi |
| DELETE | `/promotions/:id` | Admin | Vô hiệu hóa khuyến mãi |

## Reviews

| Method | Endpoint | Role | Mô tả |
| --- | --- | --- | --- |
| GET | `/reviews/public` | Public | Danh sách đánh giá đã duyệt |
| GET | `/reviews/my` | Patient | Đánh giá của khách hàng hiện tại |
| POST | `/reviews` | Patient | Gửi đánh giá cho lịch completed |
| GET | `/reviews` | Admin | Danh sách tất cả đánh giá |
| PUT | `/reviews/:id/status` | Admin | Duyệt/ẩn đánh giá |

## Dashboard, Settings, Logs

| Method | Endpoint | Role | Mô tả |
| --- | --- | --- | --- |
| GET | `/dashboard/summary` | Admin | Dashboard tổng quan |
| GET | `/settings` | Admin | Lấy cấu hình hệ thống |
| PUT | `/settings` | Admin | Cập nhật cấu hình |
| GET | `/activity-logs` | Admin | Lịch sử hoạt động |

## Upload

| Method | Endpoint | Role | Mô tả |
| --- | --- | --- | --- |
| POST | `/upload/single` | Authenticated | Upload một file |
| POST | `/upload/multiple` | Dentist, Admin, Staff | Upload nhiều file hồ sơ |

Giới hạn:

- File tối đa 5MB.
- Tối đa 5 file/lần upload nhiều.
- Hỗ trợ JPG, PNG, WEBP, PDF.

## Chat

| Method | Endpoint | Role | Mô tả |
| --- | --- | --- | --- |
| GET | `/chat/history` | Authenticated | Lịch sử chat phòng chung |

Socket URL mặc định:

```text
http://localhost:8080
```

Socket auth:

```js
io(SOCKET_URL, { auth: { token } })
```

## Health

| Method | Endpoint | Role | Mô tả |
| --- | --- | --- | --- |
| GET | `/health` | Public | Kiểm tra server và database |
