const pool = require('./database');
const { seedDemoData, demoUsers } = require('./seed_demo');

async function seedUsers() {
    try {
        await seedDemoData(pool);

        demoUsers.forEach((user) => {
            console.log(`Ready ${user.role}: ${user.email}`);
        });

        console.log('Demo users and base demo data are ready.');
    } catch (error) {
        console.error('Error seeding demo data:', error);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

seedUsers();
