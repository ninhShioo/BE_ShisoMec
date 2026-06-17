require('dotenv').config({ quiet: true });
const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

async function testUpload() {
    try {
        console.log("Testing Cloudinary connection with:");
        console.log("Cloud Name:", process.env.CLOUDINARY_CLOUD_NAME);
        console.log("API Key:", process.env.CLOUDINARY_API_KEY);
        // Do not print secret for security, but check if it exists
        console.log("API Secret Exists:", !!process.env.CLOUDINARY_API_SECRET);

        const result = await cloudinary.uploader.upload("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", {
            folder: "test"
        });
        console.log("Upload successful!");
        console.log("URL:", result.url);
    } catch (err) {
        console.error("Upload failed with error:");
        console.error(err);
    }
}

testUpload();
