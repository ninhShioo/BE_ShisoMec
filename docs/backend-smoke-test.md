# Backend Smoke Test

Smoke test kiểm tra nhanh backend bằng API thật trên server đang chạy.

## Chuẩn bị

```bash
npm run db:setup
npm run dev
```

Backend mặc định chạy ở `http://localhost:8080`.

## Chạy kiểm thử

```bash
npm run smoke:api
```

Dọn dữ liệu lịch/hóa đơn/hồ sơ do smoke test tạo:

```bash
npm run smoke:clean
```

Nếu backend chạy ở URL khác:

```bash
API_BASE_URL=http://localhost:8080/api npm run smoke:api
```

## Luồng được kiểm tra

- API root hoạt động.
- Public services có dữ liệu.
- Tài khoản demo đăng nhập được.
- Public dentists có dữ liệu.
- Route protected chặn request thiếu token.
- Dentist bị chặn khỏi danh sách hóa đơn.
- Patient tạo lịch hẹn tương lai.
- Staff phân công bác sĩ.
- Staff xác nhận lịch.
- Dentist tạo hồ sơ khám và hoàn tất lịch.
- Admin xuất hóa đơn.
- Staff thanh toán hóa đơn.
- Patient xem được hóa đơn của mình.

## Tài khoản demo

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@doan1.local` | `Admin@123` |
| Staff | `staff@doan1.local` | `Staff@123` |
| Dentist | `dentist@doan1.local` | `Dentist@123` |
| Patient | `patient@doan1.local` | `Patient@123` |
