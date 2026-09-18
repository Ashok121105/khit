const db = require("./database/database");
const bcrypt = require("bcryptjs");

async function createAdmin() {

    const username = "admin";
    const password = "admin123";

    // Check existing account
    const existing = db.prepare(`
        SELECT id, username, role
        FROM users
        WHERE username = ?
    `).get(username);

    if (existing) {

        console.log("");
        console.log("Admin account already exists.");
        console.log("Username:", existing.username);
        console.log("Role:", existing.role);
        console.log("");

        return;
    }

    // Hash password
    const hashedPassword =
        await bcrypt.hash(password, 10);

    // Create admin
    const result = db.prepare(`
        INSERT INTO users
        (
            username,
            password,
            role
        )
        VALUES (?, ?, ?)
    `).run(
        username,
        hashedPassword,
        "admin"
    );

    console.log("");
    console.log("================================");
    console.log("   ADMIN ACCOUNT CREATED");
    console.log("================================");
    console.log("Username : admin");
    console.log("Password : admin123");
    console.log("Role     : admin");
    console.log("User ID  :", result.lastInsertRowid);
    console.log("================================");
    console.log("");

}

createAdmin().catch(error => {

    console.error(
        "Admin creation error:",
        error
    );

});