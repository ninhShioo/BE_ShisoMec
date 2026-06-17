const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8080/api';

const credentials = {
    admin: { email: 'admin@doan1.local', password: 'Admin@123' },
    staff: { email: 'staff@doan1.local', password: 'Staff@123' },
    dentist: { email: 'dentist@doan1.local', password: 'Dentist@123' },
    patient: { email: 'patient@doan1.local', password: 'Patient@123' }
};

const state = {
    tokens: {},
    users: {},
    serviceId: null,
    dentistId: null,
    appointmentId: null,
    invoiceId: null
};

const formatDate = (date) => date.toISOString().slice(0, 10);

const buildFutureDate = (offset) => {
    const now = new Date();
    now.setDate(now.getDate() + offset);
    return formatDate(now);
};

const request = async (method, path, options = {}) => {
    const headers = {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
    };

    const response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;

    if (response.status !== options.expectedStatus) {
        throw new Error(`${method} ${path} expected ${options.expectedStatus}, got ${response.status}: ${text}`);
    }

    if (options.expectSuccess !== false && payload && payload.success === false) {
        throw new Error(`${method} ${path} returned success=false: ${text}`);
    }

    return payload;
};

const step = async (name, fn) => {
    process.stdout.write(`- ${name}... `);
    await fn();
    console.log('OK');
};

const findAvailableSlot = async () => {
    for (let offset = 7; offset <= 60; offset += 1) {
        const appointmentDate = buildFutureDate(offset);
        const payload = await request(
            'GET',
            `/appointments/slots?date=${appointmentDate}&dentistId=${state.dentistId}&serviceIds=${state.serviceId}`,
            {
                token: state.tokens.patient,
                expectedStatus: 200
            }
        );
        const slot = (payload.data || []).find((item) => item.available);
        if (slot) {
            return {
                appointmentDate,
                appointmentTime: `${slot.time}:00`
            };
        }
    }

    throw new Error('No available dentist slot found for smoke test.');
};

const login = async (role) => {
    const payload = await request('POST', '/auth/login', {
        expectedStatus: 200,
        body: credentials[role]
    });

    state.tokens[role] = payload.token;
    state.users[role] = payload.user;
};

const main = async () => {
    await step('API root is alive', async () => {
        const response = await fetch(API_BASE_URL.replace(/\/api$/, ''));
        if (!response.ok) {
            throw new Error(`Root endpoint returned ${response.status}`);
        }
    });

    await step('Public services are available', async () => {
        const payload = await request('GET', '/services', { expectedStatus: 200 });
        if (!Array.isArray(payload.data) || payload.data.length === 0) {
            throw new Error('No active services found. Run npm run db:setup first.');
        }

        state.serviceId = payload.data[0].id;
    });

    await step('Demo users can login', async () => {
        await login('admin');
        await login('staff');
        await login('dentist');
        await login('patient');
    });

    await step('Public dentists are available', async () => {
        const payload = await request('GET', '/users/public/dentists', { expectedStatus: 200 });
        const dentist = payload.data.find((item) => item.id === state.users.dentist.id) || payload.data[0];
        if (!dentist) {
            throw new Error('No active dentist found. Run npm run db:setup first.');
        }

        state.dentistId = dentist.id;
    });

    await step('Protected route rejects anonymous request', async () => {
        await request('GET', '/appointments', {
            expectedStatus: 401,
            expectSuccess: false
        });
    });

    await step('Dentist cannot read invoices', async () => {
        await request('GET', '/invoices', {
            token: state.tokens.dentist,
            expectedStatus: 403,
            expectSuccess: false
        });
    });

    await step('Patient creates a future appointment', async () => {
        const slot = await findAvailableSlot();
        const payload = await request('POST', '/appointments', {
            token: state.tokens.patient,
            expectedStatus: 201,
            body: {
                ...slot,
                dentistId: state.dentistId,
                serviceIds: [state.serviceId],
                notes: 'Smoke test appointment'
            }
        });

        state.appointmentId = payload.data.appointmentId;
    });

    await step('Staff assigns dentist', async () => {
        await request('PUT', `/appointments/${state.appointmentId}/assign`, {
            token: state.tokens.staff,
            expectedStatus: 200,
            body: { dentistId: state.dentistId }
        });
    });

    await step('Staff confirms appointment', async () => {
        await request('PUT', `/appointments/${state.appointmentId}/status`, {
            token: state.tokens.staff,
            expectedStatus: 200,
            body: { status: 'confirmed' }
        });
    });

    await step('Dentist creates medical record and completes appointment', async () => {
        await request('POST', '/records', {
            token: state.tokens.dentist,
            expectedStatus: 201,
            body: {
                appointmentId: state.appointmentId,
                diagnosis: 'Kiểm tra smoke test',
                prescription: 'Theo dõi và tái khám khi cần',
                notes: 'Created by smoke_api.js',
                attachments: []
            }
        });
    });

    await step('Admin creates invoice', async () => {
        const payload = await request('POST', '/invoices', {
            token: state.tokens.admin,
            expectedStatus: 201,
            body: {
                appointmentId: state.appointmentId,
                paymentMethod: 'cash'
            }
        });

        state.invoiceId = payload.data.id;
    });

    await step('Staff pays invoice', async () => {
        await request('PUT', `/invoices/${state.invoiceId}/pay`, {
            token: state.tokens.staff,
            expectedStatus: 200,
            body: {
                paymentMethod: 'cash',
                transactionId: `SMOKE-${Date.now()}`
            }
        });
    });

    await step('Patient can read own invoice list', async () => {
        const payload = await request('GET', '/invoices', {
            token: state.tokens.patient,
            expectedStatus: 200
        });

        const hasCreatedInvoice = payload.data.some((invoice) => invoice.id === state.invoiceId);
        if (!hasCreatedInvoice) {
            throw new Error(`Patient invoice list does not include invoice ${state.invoiceId}`);
        }
    });

    console.log('\nSmoke API passed.');
};

main().catch((error) => {
    console.error('\nSmoke API failed.');
    console.error(error.message);
    process.exit(1);
});
