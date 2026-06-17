# Demo Checklist

Checklist dùng trước khi báo cáo hoặc chấm đồ án.

## Trước khi demo

```bash
npm run doctor
npm run db:setup
npm run smoke:api
```

Build frontend:

```bash
cd frontend
npm run build
```

## Kiểm tra màn hình chính

- Trang chủ hiển thị logo Phenikaa Dental.
- Dịch vụ lấy từ database.
- Bác sĩ lấy từ database.
- Form đặt lịch chặn ngày/giờ quá khứ.
- Giao diện không còn chữ "Nha khoa DOAN 1".

## Kiểm tra role Patient

- Đăng nhập `patient@doan1.local`.
- Đặt lịch mới.
- Xem lịch của chính mình.
- Không xem được hóa đơn của người khác.
- Không vào được khu quản trị.

## Kiểm tra role Staff

- Đăng nhập `staff@doan1.local`.
- Xem danh sách lịch.
- Phân công bác sĩ.
- Xác nhận lịch.
- Xuất và thanh toán hóa đơn sau khi lịch hoàn thành.

## Kiểm tra role Dentist

- Đăng nhập `dentist@doan1.local`.
- Chỉ thấy lịch được phân công.
- Tạo hồ sơ khám cho lịch đã xác nhận.
- Không xem được danh sách hóa đơn.

## Kiểm tra role Admin

- Đăng nhập `admin@doan1.local`.
- Quản lý user.
- Quản lý dịch vụ, danh mục, khuyến mãi.
- Xem dashboard và activity logs.
- Cập nhật settings hệ thống.

## Luồng demo đề xuất

1. Mở trang chủ, giới thiệu dịch vụ và bác sĩ lấy từ DB.
2. Patient đặt lịch tương lai.
3. Staff phân công bác sĩ và xác nhận.
4. Dentist tạo hồ sơ khám.
5. Staff xuất hóa đơn và thanh toán.
6. Patient xem hóa đơn/hồ sơ.
7. Admin xem dashboard/logs.
