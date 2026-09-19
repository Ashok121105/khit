// ============================================================
// KHIT FAMILY PORTAL
// Complete Backend Server
// Node.js + Express + SQLite
// ============================================================

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const multer = require("multer");
const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");

const db = require("./database/database");

const app = express();

const PORT = process.env.PORT || 5000;
const JWT_SECRET =
    process.env.JWT_SECRET || "khit_family_secret_2026";
const ALLOWED_ADMIN_USERNAME = "Ashok1211";
const ALLOWED_ADMIN_PASSWORD = "Ashok@1211";

const uploadDirectory = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDirectory)) {
    fs.mkdirSync(uploadDirectory, { recursive: true });
}

const allowedUploadExtensions = new Set([
    ".pdf",
    ".doc",
    ".docx",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
    ".csv",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".mp4"
]);

const upload = multer({
    storage: multer.diskStorage({
        destination: uploadDirectory,
        filename: (req, file, callback) => {
            const extension = path.extname(file.originalname).toLowerCase();
            const baseName = path
                .basename(file.originalname, extension)
                .replace(/[^a-zA-Z0-9_-]/g, "-")
                .slice(0, 60);

            callback(
                null,
                `${Date.now()}-${baseName || "upload"}${extension}`
            );
        }
    }),
    limits: {
        fileSize: 10 * 1024 * 1024
    },
    fileFilter: (req, file, callback) => {
        const extension = path.extname(file.originalname).toLowerCase();
        callback(null, allowedUploadExtensions.has(extension));
    }
});


// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors());

app.use(express.json({ limit: "10mb" }));

app.use(express.urlencoded({
    extended: true,
    limit: "10mb"
}));


// Serve frontend files
app.use(express.static(path.join(__dirname)));


// ============================================================
// DATABASE INITIALIZATION
// ============================================================

function ensureStudentProfileColumns() {
    const tableInfo = db.prepare("PRAGMA table_info(students)").all();
    const existingColumns = new Set(tableInfo.map((column) => column.name));

    const requiredColumns = [
        ["dob", "TEXT"],
        ["gender", "TEXT"],
        ["parent_name", "TEXT"],
        ["parent_mobile", "TEXT"],
        ["parent_email", "TEXT"],
        ["address", "TEXT"],
        ["city", "TEXT"],
        ["district", "TEXT"],
        ["state", "TEXT"],
        ["pincode", "TEXT"],
        ["profile_photo", "TEXT"],
        ["linkedin_url", "TEXT"],
        ["github_url", "TEXT"],
        ["portfolio_url", "TEXT"]
    ];

    requiredColumns.forEach(([columnName, columnType]) => {
        if (!existingColumns.has(columnName)) {
            db.exec(`ALTER TABLE students ADD COLUMN ${columnName} ${columnType};`);
        }
    });
}

function ensureAuditLogColumns() {
    const tableInfo = db.prepare("PRAGMA table_info(audit_logs)").all();
    const existingColumns = new Set(tableInfo.map((column) => column.name));

    const requiredColumns = [
        ["entity_type", "TEXT"],
        ["entity_id", "INTEGER"],
        ["metadata", "TEXT"]
    ];

    requiredColumns.forEach(([columnName, columnType]) => {
        if (!existingColumns.has(columnName)) {
            db.exec(`ALTER TABLE audit_logs ADD COLUMN ${columnName} ${columnType};`);
        }
    });
}

try {

    const schemaPath =
        path.join(
            __dirname,
            "database",
            "schema.sql"
        );

    if (fs.existsSync(schemaPath)) {

        const schema =
            fs.readFileSync(
                schemaPath,
                "utf8"
            );

        db.exec(schema);

        console.log(
            "Database schema loaded successfully."
        );
    }

    ensureStudentProfileColumns();
    ensureAuditLogColumns();

} catch (error) {

    console.error(
        "Database schema error:",
        error
    );

}


// ============================================================
// EXTRA NOTIFICATION TABLE
// ============================================================

try {

    db.exec(`
        CREATE TABLE IF NOT EXISTS notification_reads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            notification_id INTEGER NOT NULL,
            student_id INTEGER NOT NULL,
            read_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            UNIQUE(notification_id, student_id),

            FOREIGN KEY(notification_id)
            REFERENCES notifications(id)
            ON DELETE CASCADE,

            FOREIGN KEY(student_id)
            REFERENCES students(id)
            ON DELETE CASCADE
        );
    `);

    console.log(
        "notification_reads table ready."
    );

} catch (error) {

    console.error(
        "Notification table error:",
        error
    );

}


// ============================================================
// FUTURE STUDENT-SPECIFIC NOTIFICATION TABLE
// ============================================================

try {

    db.exec(`
        CREATE TABLE IF NOT EXISTS notification_recipients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            notification_id INTEGER NOT NULL,

            student_id INTEGER NOT NULL,

            FOREIGN KEY(notification_id)
            REFERENCES notifications(id)
            ON DELETE CASCADE,

            FOREIGN KEY(student_id)
            REFERENCES students(id)
            ON DELETE CASCADE,

            UNIQUE(notification_id, student_id)
        );
    `);

} catch (error) {

    console.error(
        "Notification recipients table error:",
        error
    );

}


try {

    db.exec(`
        CREATE TABLE IF NOT EXISTS app_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            setting_key TEXT UNIQUE NOT NULL,
            setting_value TEXT NOT NULL,
            description TEXT,
            updated_by INTEGER,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE SET NULL
        );
    `);

    const defaultSettings = [
        ["demo_data_mode", "true", "Keep unofficial records clearly marked as sample data."],
        ["public_registration", "false", "Allow public self-registration without admin approval."],
        ["payment_gateway", "false", "Enable external payment processing."],
        ["registration_approval", "false", "Require admin approval before new registrations are activated."],
        ["email_notifications", "true", "Send email notifications for portal updates."]
    ];

    const insertDefaultSetting = db.prepare(`
        INSERT OR IGNORE INTO app_settings (setting_key, setting_value, description)
        VALUES (?, ?, ?)
    `);

    defaultSettings.forEach(([key, value, description]) => {
        insertDefaultSetting.run(key, value, description);
    });

    console.log("app_settings table ready.");

    ensureDemoAccounts();

} catch (error) {

    console.error("App settings table error:", error);

}


try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS password_reset_otps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            otp_hash TEXT NOT NULL,
            expires_at DATETIME NOT NULL,
            used_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    `);
    console.log("password_reset_otps table ready.");
} catch (error) {
    console.error("Password reset table error:", error);
}

function getMailTransport() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
        return null;
    }

    return nodemailer.createTransport({
        host,
        port,
        secure: process.env.SMTP_SECURE === "true",
        auth: { user, pass }
    });
}


function createPasswordResetOtp() {
    return String(Math.floor(100000 + Math.random() * 900000));
}


// ============================================================
// HELPER FUNCTIONS
// ============================================================

async function ensureDemoAccounts() {
    try {
        const customAdminUser = db.prepare(`
            SELECT id
            FROM users
            WHERE username = ?
        `).get(ALLOWED_ADMIN_USERNAME);

        if (!customAdminUser) {
            const customAdminPasswordHash = await bcrypt.hash(ALLOWED_ADMIN_PASSWORD, 10);
            db.prepare(`
                INSERT INTO users (username, password, role)
                VALUES (?, ?, 'admin')
            `).run(ALLOWED_ADMIN_USERNAME, customAdminPasswordHash);
            console.log(`Custom admin account created: ${ALLOWED_ADMIN_USERNAME} / ${ALLOWED_ADMIN_PASSWORD}`);
        }

        const defaultAdminUser = db.prepare(`
            SELECT id
            FROM users
            WHERE username = ?
        `).get("admin");

        if (defaultAdminUser) {
            db.prepare(`
                DELETE FROM users
                WHERE username = ?
            `).run("admin");
            console.log("Default demo admin removed to restrict access to the custom admin account.");
        }

        const studentUser = db.prepare(`
            SELECT u.id, s.id AS student_record_id, s.student_id
            FROM users u
            LEFT JOIN students s ON s.user_id = u.id
            WHERE u.username = ?
        `).get("student");

        if (!studentUser) {
            const studentPasswordHash = await bcrypt.hash("student123", 10);
            const userResult = db.prepare(`
                INSERT INTO users (username, password, role)
                VALUES (?, ?, 'student')
            `).run("student", studentPasswordHash);

            db.prepare(`
                INSERT INTO students (
                    user_id,
                    student_id,
                    roll_number,
                    full_name,
                    email,
                    mobile,
                    department,
                    year,
                    section,
                    academic_year,
                    fee_category,
                    parent_name,
                    parent_mobile,
                    parent_email,
                    address,
                    city,
                    district,
                    state,
                    pincode
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                userResult.lastInsertRowid,
                "STU-1001",
                "STU-1001",
                "Demo Student",
                "student@khit.edu.in",
                "9876543210",
                "Computer Science",
                2,
                "A",
                "2026-27",
                "Management",
                "Demo Parent",
                "9876500001",
                "parent@khit.edu.in",
                "123 Demo Street",
                "Hyderabad",
                "Rangareddy",
                "Telangana",
                "500001"
            );

            console.log("Demo student account created: student / student123");
        } else if (!studentUser.student_record_id) {
            db.prepare(`
                INSERT INTO students (
                    user_id,
                    student_id,
                    roll_number,
                    full_name,
                    email,
                    mobile,
                    department,
                    year,
                    section,
                    academic_year,
                    fee_category,
                    parent_name,
                    parent_mobile,
                    parent_email,
                    address,
                    city,
                    district,
                    state,
                    pincode
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                studentUser.id,
                "STU-1001",
                "STU-1001",
                "Demo Student",
                "student@khit.edu.in",
                "9876543210",
                "Computer Science",
                2,
                "A",
                "2026-27",
                "Management",
                "Demo Parent",
                "9876500001",
                "parent@khit.edu.in",
                "123 Demo Street",
                "Hyderabad",
                "Rangareddy",
                "Telangana",
                "500001"
            );
        }

        const facultyUser = db.prepare(`
            SELECT u.id, f.id AS faculty_record_id
            FROM users u
            LEFT JOIN faculty f ON f.user_id = u.id
            WHERE u.username = ?
        `).get("faculty");

        if (!facultyUser) {
            const facultyPasswordHash = await bcrypt.hash("faculty123", 10);
            const userResult = db.prepare(`
                INSERT INTO users (username, password, role)
                VALUES (?, ?, 'faculty')
            `).run("faculty", facultyPasswordHash);

            db.prepare(`
                INSERT INTO faculty (faculty_id, full_name, department, designation, email, mobile, user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                "FAC-1001",
                "Demo Faculty",
                "Computer Science",
                "Assistant Professor",
                "faculty@khit.edu.in",
                "9988776655",
                userResult.lastInsertRowid
            );

            console.log("Demo faculty account created: faculty / faculty123");
        }

        const demoStudent = db.prepare(`
            SELECT id
            FROM students
            WHERE student_id = ?
        `).get("STU-1001");

        if (demoStudent) {
            const feeCount = db.prepare(`
                SELECT COUNT(*) AS count
                FROM fees
                WHERE student_id = ?
            `).get(demoStudent.id).count;

            if (feeCount === 0) {
                db.prepare(`
                    INSERT INTO fees (student_id, academic_year, fee_year, total_amount, paid_amount, pending_amount, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(demoStudent.id, "2026-27", 2, 45000, 28000, 17000, "Partial");
            }

            const subjectCount = db.prepare(`SELECT COUNT(*) AS count FROM subjects`).get().count;
            if (subjectCount === 0) {
                db.prepare(`
                    INSERT INTO subjects (name, code, department, year, semester, section)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run("Data Structures", "DS-101", "Computer Science", 2, 3, "A");
                db.prepare(`
                    INSERT INTO subjects (name, code, department, year, semester, section)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run("Database Management Systems", "DBMS-201", "Computer Science", 2, 3, "A");
                db.prepare(`
                    INSERT INTO subjects (name, code, department, year, semester, section)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run("Operating Systems", "OS-301", "Computer Science", 2, 3, "A");
            }

            const attendanceCount = db.prepare(`
                SELECT COUNT(*) AS count
                FROM attendance
                WHERE student_id = ?
            `).get(demoStudent.id).count;

            if (attendanceCount === 0) {
                const subjects = db.prepare(`SELECT id, name FROM subjects ORDER BY id LIMIT 3`).all();
                const dates = ["2026-09-02", "2026-09-04", "2026-09-06", "2026-09-09", "2026-09-11"];
                const statuses = ["Present", "Present", "Absent", "Present", "Leave"];

                for (let idx = 0; idx < dates.length; idx += 1) {
                    const subject = subjects[idx % subjects.length];
                    db.prepare(`
                        INSERT INTO attendance (student_id, subject, attendance_date, status)
                        VALUES (?, ?, ?, ?)
                    `).run(demoStudent.id, subject.name, dates[idx], statuses[idx]);
                }
            }

            const marksCount = db.prepare(`
                SELECT COUNT(*) AS count
                FROM marks
                WHERE student_id = ?
            `).get(demoStudent.id).count;

            if (marksCount === 0) {
                const subjects = db.prepare(`SELECT id, name FROM subjects ORDER BY id LIMIT 3`).all();
                const sampleMarks = [
                    [subjects[0].id, "Midterm", 84, 100],
                    [subjects[1].id, "Quiz", 92, 100],
                    [subjects[2].id, "Assignment", 88, 100]
                ];

                sampleMarks.forEach(([subjectId, examType, marks, maxMarks]) => {
                    db.prepare(`
                        INSERT INTO marks (student_id, subject_id, exam_type, marks, max_marks, exam_date)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `).run(demoStudent.id, subjectId, examType, marks, maxMarks, "2026-09-15");
                });
            }

            const notificationCount = db.prepare(`SELECT COUNT(*) AS count FROM notifications`).get().count;
            if (notificationCount === 0) {
                db.prepare(`
                    INSERT INTO notifications (title, message, audience, is_read, created_at)
                    VALUES (?, ?, ?, ?, datetime('now'))
                `).run("Welcome to KHIT Family", "Your student portal is ready. Please review your profile and fee updates.", "All", 0);
                db.prepare(`
                    INSERT INTO notifications (title, message, audience, is_read, created_at)
                    VALUES (?, ?, ?, ?, datetime('now'))
                `).run("Mid-Semester Review", "Parents can now review attendance and marks from the dashboard.", "Parents", 0);
            }
        }
    } catch (error) {
        console.error("Demo account setup error:", error);
    }
}

function generateToken(user) {

    return jwt.sign(
        {
            id: user.id,
            username: user.username,
            role: user.role
        },
        JWT_SECRET,
        {
            expiresIn: "1d"
        }
    );

}


function getTokenFromRequest(req) {

    const auth =
        req.headers.authorization;

    if (!auth) {
        return null;
    }

    if (!auth.startsWith("Bearer ")) {
        return null;
    }

    return auth.substring(7);

}


// ============================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================

function authenticateToken(req, res, next) {

    const token =
        getTokenFromRequest(req);

    if (!token) {

        return res.status(401).json({
            status: "error",
            message: "Authentication token required"
        });

    }

    try {

        const decoded =
            jwt.verify(
                token,
                JWT_SECRET
            );

        req.user = decoded;

        next();

    } catch (error) {

        return res.status(401).json({
            status: "error",
            message: "Invalid or expired token"
        });

    }

}


// ============================================================
// STUDENT AUTH MIDDLEWARE
// ============================================================

function requireStudent(req, res, next) {

    if (
        !req.user ||
        req.user.role !== "student"
    ) {

        return res.status(403).json({
            status: "error",
            message: "Student access required"
        });

    }

    next();

}


// ============================================================
// ADMIN AUTH MIDDLEWARE
// ============================================================

function requireAdmin(req, res, next) {

    if (!req.user) {

        return res.status(401).json({
            status: "error",
            message: "Authentication required"
        });

    }

    if (
        req.user.role !== "admin" &&
        req.user.role !== "superadmin"
    ) {

        return res.status(403).json({
            status: "error",
            message: "Admin access required"
        });

    }

    next();

}


// ============================================================
// PARENT AUTH MIDDLEWARE
// ============================================================

function requireParent(req, res, next) {

    if (!req.user) {

        return res.status(401).json({
            status: "error",
            message: "Authentication required"
        });

    }

    if (req.user.role !== "parent") {

        return res.status(403).json({
            status: "error",
            message: "Parent access required"
        });

    }

    next();

}

function requireFaculty(req, res, next) {

    if (!req.user) {
        return res.status(401).json({
            status: "error",
            message: "Authentication required"
        });
    }

    if (req.user.role !== "faculty") {
        return res.status(403).json({
            status: "error",
            message: "Faculty access required"
        });
    }

    next();
}


// ============================================================
// ADMIN FILE UPLOADS
// ============================================================

app.post(
    "/api/admin/uploads",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        upload.single("file")(req, res, error => {

            if (error) {
                return res.status(400).json({
                    status: "error",
                    message: error.code === "LIMIT_FILE_SIZE"
                        ? "File size must be 10 MB or less"
                        : "Unsupported or invalid upload"
                });
            }

            if (!req.file) {
                return res.status(400).json({
                    status: "error",
                    message: "A file is required"
                });
            }

            const fileUrl = `/uploads/${req.file.filename}`;

            db.prepare(`
                INSERT INTO audit_logs (user_id, action, entity_type, metadata)
                VALUES (?, ?, ?, ?)
            `).run(
                req.user.id,
                "UPLOAD",
                "file",
                JSON.stringify({
                    originalName: req.file.originalname,
                    fileUrl,
                    size: req.file.size,
                    mimeType: req.file.mimetype
                })
            );

            return res.status(201).json({
                status: "success",
                message: "File uploaded successfully",
                file: {
                    original_name: req.file.originalname,
                    file_name: req.file.filename,
                    file_url: fileUrl,
                    size: req.file.size,
                    mime_type: req.file.mimetype
                }
            });
        });
    }
);

app.get(
    "/api/admin/documents",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const documents = db.prepare(`
                SELECT
                    d.*,
                    u.username
                FROM documents d
                LEFT JOIN users u ON u.id = d.user_id
                ORDER BY d.uploaded_at DESC, d.id DESC
            `).all();

            return res.json({
                status: "success",
                documents
            });

        } catch (error) {

            console.error("Admin documents load error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/admin/documents",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        upload.single("file")(req, res, error => {

            if (error) {
                return res.status(400).json({
                    status: "error",
                    message: error.code === "LIMIT_FILE_SIZE"
                        ? "File size must be 10 MB or less"
                        : "Unsupported or invalid upload"
                });
            }

            const documentName = String(req.body.document_name || "").trim();
            const documentType = String(req.body.document_type || "Other").trim();
            const userId = req.body.user_id ? Number(req.body.user_id) : null;

            if (!documentName || !req.file) {
                return res.status(400).json({
                    status: "error",
                    message: "Document name and file are required"
                });
            }

            if (userId) {
                const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
                if (!user) {
                    fs.unlinkSync(req.file.path);
                    return res.status(404).json({
                        status: "error",
                        message: "Target user not found"
                    });
                }
            }

            try {

                const fileUrl = `/uploads/${req.file.filename}`;
                const result = db.prepare(`
                    INSERT INTO documents
                        (user_id, document_name, document_type, file_url)
                    VALUES (?, ?, ?, ?)
                `).run(userId, documentName, documentType, fileUrl);

                db.prepare(`
                    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
                    VALUES (?, ?, ?, ?, ?)
                `).run(
                    req.user.id,
                    "UPLOAD",
                    "document",
                    result.lastInsertRowid,
                    JSON.stringify({ documentName, documentType, userId, fileUrl })
                );

                return res.status(201).json({
                    status: "success",
                    message: "Document uploaded",
                    document_id: result.lastInsertRowid,
                    file_url: fileUrl
                });

            } catch (databaseError) {
                fs.unlinkSync(req.file.path);
                console.error("Admin document save error:", databaseError);
                return res.status(500).json({
                    status: "error",
                    message: databaseError.message
                });
            }
        });
    }
);


// ============================================================
// APP SETTINGS
// ============================================================

app.get(
    "/api/admin/settings",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        try {
            const rows = db.prepare(`
                SELECT setting_key, setting_value, description, updated_at
                FROM app_settings
                ORDER BY setting_key ASC
            `).all();

            const settings = {};
            rows.forEach((row) => {
                const value = row.setting_value;
                settings[row.setting_key] = value === "true" ? true : value === "false" ? false : value;
            });

            return res.json({
                status: "success",
                settings
            });

        } catch (error) {
            console.error("Admin settings load error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);

app.put(
    "/api/admin/settings",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        try {
            const updates = req.body || {};
            if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
                return res.status(400).json({
                    status: "error",
                    message: "Settings payload must be an object"
                });
            }

            const allowedKeys = new Set([
                "demo_data_mode",
                "public_registration",
                "payment_gateway",
                "registration_approval",
                "email_notifications"
            ]);

            const rowsToUpdate = [];
            Object.entries(updates).forEach(([key, value]) => {
                if (!allowedKeys.has(key)) {
                    return;
                }

                const normalizedValue = value === true || value === "true" ? "true" : "false";
                rowsToUpdate.push({ key, value: normalizedValue });
            });

            if (rowsToUpdate.length === 0) {
                return res.status(400).json({
                    status: "error",
                    message: "No valid settings provided"
                });
            }

            const stmt = db.prepare(`
                INSERT INTO app_settings (setting_key, setting_value, updated_by, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(setting_key) DO UPDATE SET
                    setting_value = excluded.setting_value,
                    updated_by = excluded.updated_by,
                    updated_at = CURRENT_TIMESTAMP
            `);

            rowsToUpdate.forEach(({ key, value }) => {
                stmt.run(key, value, req.user.id);
            });

            const updatedSettings = db.prepare(`
                SELECT setting_key, setting_value
                FROM app_settings
                WHERE setting_key IN (${rowsToUpdate.map(() => "?").join(", ")})
            `).all(...rowsToUpdate.map(({ key }) => key));

            const responseSettings = {};
            updatedSettings.forEach((row) => {
                responseSettings[row.setting_key] = row.setting_value === "true";
            });

            db.prepare(`
                INSERT INTO audit_logs (user_id, action, entity_type, metadata)
                VALUES (?, ?, ?, ?)
            `).run(
                req.user.id,
                "UPDATE_SETTINGS",
                "app_settings",
                JSON.stringify({ updates: responseSettings })
            );

            return res.json({
                status: "success",
                message: "Settings updated successfully",
                settings: responseSettings
            });

        } catch (error) {
            console.error("Admin settings update error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);


// ============================================================
// HOME
// ============================================================

app.get("/", (req, res) => {
    res.redirect("/index.html");
});


// ============================================================
// SERVER STATUS
// ============================================================

app.get("/api/status", (req, res) => {

    res.json({
        status: "success",
        message: "KHIT Family Portal API is running",
        server: "online",
        port: PORT
    });

});

app.get("/api/demo-credentials", async (req, res) => {
    try {
        await ensureDemoAccounts();

        return res.json({
            status: "success",
            demoAccounts: {
                admin: {
                    username: ALLOWED_ADMIN_USERNAME,
                    password: ALLOWED_ADMIN_PASSWORD,
                    username: "student",
                    password: "student123",
                    role: "student",
                    student_id: "STU-1001"
                },
                parent: {
                    student_id: "STU-1001",
                    parent_mobile: "9876500001",
                    parent_email: "parent@khit.edu.in"
                }
            }
        });
    } catch (error) {
        console.error("Demo credentials error:", error);
        return res.status(500).json({
            status: "error",
            message: "Unable to fetch demo credentials"
        });
    }
});


// ============================================================
// GENERIC LOGIN
// ============================================================

app.post("/api/password-reset/request", async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const email = String(req.body.email || "").trim().toLowerCase();
        const transport = getMailTransport();

        if (!username || !email) {
            return res.status(400).json({
                status: "error",
                message: "Username and registered email are required"
            });
        }

        if (!transport) {
            return res.status(503).json({
                status: "error",
                message: "Password reset email is not configured yet"
            });
        }

        const user = db.prepare(`
            SELECT u.id, u.username, s.email, s.full_name
            FROM users u
            JOIN students s ON s.user_id = u.id
            WHERE u.username = ? AND u.role = 'student' AND lower(s.email) = ?
        `).get(username, email);

        if (!user) {
            return res.status(400).json({
                status: "error",
                message: "Username and registered email do not match"
            });
        }

        const otp = createPasswordResetOtp();
        const otpHash = await bcrypt.hash(otp, 10);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        db.prepare(`
            UPDATE password_reset_otps
            SET used_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND used_at IS NULL
        `).run(user.id);

        db.prepare(`
            INSERT INTO password_reset_otps (user_id, otp_hash, expires_at)
            VALUES (?, ?, ?)
        `).run(user.id, otpHash, expiresAt);

        await transport.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: user.email,
            subject: "KHIT Family password reset OTP",
            text: `Hello ${user.full_name || user.username},\n\nYour KHIT Family password reset OTP is ${otp}. It expires in 10 minutes.\n\nIf you did not request this, ignore this email.`
        });

        return res.json({
            status: "success",
            message: "OTP sent to your registered email"
        });
    } catch (error) {
        console.error("Password reset request error:", error);
        return res.status(500).json({
            status: "error",
            message: "Unable to send password reset OTP"
        });
    }
});


app.post("/api/password-reset/confirm", async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const email = String(req.body.email || "").trim().toLowerCase();
        const otp = String(req.body.otp || "").trim();
        const newPassword = String(req.body.newPassword || "");

        if (!username || !email || !otp || newPassword.length < 8) {
            return res.status(400).json({
                status: "error",
                message: "Username, email, OTP, and an 8-character password are required"
            });
        }

        const user = db.prepare(`
            SELECT u.id
            FROM users u
            JOIN students s ON s.user_id = u.id
            WHERE u.username = ? AND u.role = 'student' AND lower(s.email) = ?
        `).get(username, email);

        const reset = user && db.prepare(`
            SELECT *
            FROM password_reset_otps
            WHERE user_id = ? AND used_at IS NULL
            ORDER BY id DESC
            LIMIT 1
        `).get(user.id);

        if (!reset || new Date(reset.expires_at).getTime() < Date.now()) {
            return res.status(400).json({
                status: "error",
                message: "OTP is invalid or expired"
            });
        }

        if (!(await bcrypt.compare(otp, reset.otp_hash))) {
            return res.status(400).json({
                status: "error",
                message: "OTP is invalid or expired"
            });
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);
        db.prepare("UPDATE users SET password = ? WHERE id = ?").run(passwordHash, user.id);
        db.prepare("UPDATE password_reset_otps SET used_at = CURRENT_TIMESTAMP WHERE id = ?").run(reset.id);

        return res.json({
            status: "success",
            message: "Password reset successful. You can login now."
        });
    } catch (error) {
        console.error("Password reset confirmation error:", error);
        return res.status(500).json({
            status: "error",
            message: "Unable to reset password"
        });
    }
});


app.post("/api/admin-password-reset/request", async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const email = String(req.body.email || "").trim().toLowerCase();
        const configuredEmail = String(process.env.ADMIN_RESET_EMAIL || "").trim().toLowerCase();
        const transport = getMailTransport();

        if (!username || !email) {
            return res.status(400).json({ status: "error", message: "Admin username and reset email are required" });
        }

        if (!transport || !configuredEmail) {
            return res.status(503).json({ status: "error", message: "Admin password reset email is not configured yet" });
        }

        const user = db.prepare(`
            SELECT id, username
            FROM users
            WHERE username = ? AND role IN ('admin', 'superadmin')
        `).get(username);

        if (!user || email !== configuredEmail) {
            return res.status(400).json({ status: "error", message: "Admin username and reset email do not match" });
        }

        const otp = createPasswordResetOtp();
        const otpHash = await bcrypt.hash(otp, 10);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        db.prepare(`
            UPDATE password_reset_otps
            SET used_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND used_at IS NULL
        `).run(user.id);
        db.prepare(`
            INSERT INTO password_reset_otps (user_id, otp_hash, expires_at)
            VALUES (?, ?, ?)
        `).run(user.id, otpHash, expiresAt);

        await transport.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: configuredEmail,
            subject: "KHIT Family admin password reset OTP",
            text: `Your KHIT Family admin password reset OTP is ${otp}. It expires in 10 minutes.`
        });

        return res.json({ status: "success", message: "OTP sent to the configured admin email" });
    } catch (error) {
        console.error("Admin password reset request error:", error);
        return res.status(500).json({ status: "error", message: "Unable to send admin password reset OTP" });
    }
});


app.post("/api/admin-password-reset/confirm", async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const email = String(req.body.email || "").trim().toLowerCase();
        const otp = String(req.body.otp || "").trim();
        const newPassword = String(req.body.newPassword || "");
        const configuredEmail = String(process.env.ADMIN_RESET_EMAIL || "").trim().toLowerCase();

        if (!username || email !== configuredEmail || !otp || newPassword.length < 8) {
            return res.status(400).json({ status: "error", message: "Valid admin email, OTP, and an 8-character password are required" });
        }

        const user = db.prepare(`
            SELECT id
            FROM users
            WHERE username = ? AND role IN ('admin', 'superadmin')
        `).get(username);
        const reset = user && db.prepare(`
            SELECT * FROM password_reset_otps
            WHERE user_id = ? AND used_at IS NULL
            ORDER BY id DESC LIMIT 1
        `).get(user.id);

        if (!reset || new Date(reset.expires_at).getTime() < Date.now() || !(await bcrypt.compare(otp, reset.otp_hash))) {
            return res.status(400).json({ status: "error", message: "OTP is invalid or expired" });
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);
        db.prepare("UPDATE users SET password = ? WHERE id = ?").run(passwordHash, user.id);
        db.prepare("UPDATE password_reset_otps SET used_at = CURRENT_TIMESTAMP WHERE id = ?").run(reset.id);

        return res.json({ status: "success", message: "Admin password reset successful. You can login now." });
    } catch (error) {
        console.error("Admin password reset confirmation error:", error);
        return res.status(500).json({ status: "error", message: "Unable to reset admin password" });
    }
});

app.post(
    "/api/login",
    async (req, res) => {
        try {
            const {
                username,
                password,
                role,
                student_id: studentId,
                parent_mobile: parentMobile,
                parent_email: parentEmail
            } = req.body;

            const requestedRole = String(role || "").trim().toLowerCase();

            if (requestedRole === "parent" || studentId) {
                const normalizedStudentId = String(studentId || "").trim();
                const normalizedMobile = parentMobile ? String(parentMobile).trim() : "";
                const normalizedEmail = parentEmail ? String(parentEmail).trim() : "";

                if (!normalizedStudentId || (!normalizedMobile && !normalizedEmail)) {
                    return res.status(400).json({
                        status: "error",
                        message: "Student ID and parent mobile or email are required"
                    });
                }

                const student = db.prepare(`
                    SELECT *
                    FROM students
                    WHERE student_id = ?
                      AND (
                        parent_mobile = ? OR parent_email = ?
                      )
                `).get(
                    normalizedStudentId,
                    normalizedMobile || null,
                    normalizedEmail || null
                );

                if (!student) {
                    return res.status(401).json({
                        status: "error",
                        message: "Parent credentials do not match any student record"
                    });
                }

                const token = jwt.sign(
                    {
                        id: student.user_id,
                        role: "parent",
                        parent_name: student.parent_name,
                        student_id: student.student_id
                    },
                    JWT_SECRET,
                    { expiresIn: "1d" }
                );

                return res.json({
                    status: "success",
                    message: "Parent login successful",
                    token,
                    user: {
                        id: student.user_id,
                        username: student.student_id,
                        role: "parent"
                    },
                    student: {
                        id: student.id,
                        student_id: student.student_id,
                        full_name: student.full_name,
                        department: student.department,
                        year: student.year,
                        section: student.section,
                        parent_name: student.parent_name
                    }
                });
            }

            if (!username || !password) {
                return res.status(400).json({
                    status: "error",
                    message: "Username and password are required"
                });
            }

            if (requestedRole === "admin" || requestedRole === "superadmin") {
                if (username !== ALLOWED_ADMIN_USERNAME) {
                    return res.status(401).json({
                        status: "error",
                        message: "Invalid admin credentials"
                    });
                }

                const user = db.prepare(`
                    SELECT *
                    FROM users
                    WHERE username = ?
                    AND role IN ('admin', 'superadmin')
                `).get(username);

                if (!user) {
                    return res.status(401).json({
                        status: "error",
                        message: "Invalid admin credentials"
                    });
                }

                const passwordMatch = await bcrypt.compare(password, user.password);

                if (!passwordMatch) {
                    return res.status(401).json({
                        status: "error",
                        message: "Invalid admin credentials"
                    });
                }

                const token = generateToken(user);

                return res.json({
                    status: "success",
                    message: "Admin login successful",
                    token,
                    user: {
                        id: user.id,
                        username: user.username,
                        role: user.role
                    }
                });
            }

            if (requestedRole === "faculty") {
                const user = db.prepare(`
                    SELECT *
                    FROM users
                    WHERE username = ?
                    AND role = 'faculty'
                `).get(username);

                if (!user) {
                    return res.status(401).json({
                        status: "error",
                        message: "Invalid faculty credentials"
                    });
                }

                const passwordMatch = await bcrypt.compare(password, user.password);
                if (!passwordMatch) {
                    return res.status(401).json({
                        status: "error",
                        message: "Invalid faculty credentials"
                    });
                }

                const faculty = db.prepare(`
                    SELECT *
                    FROM faculty
                    WHERE user_id = ?
                `).get(user.id);

                const token = generateToken(user);
                return res.json({
                    status: "success",
                    message: "Faculty login successful",
                    token,
                    user: {
                        id: user.id,
                        username: user.username,
                        role: user.role
                    },
                    faculty: faculty || {
                        id: null,
                        faculty_id: "FAC-1001",
                        full_name: "Demo Faculty",
                        department: "Computer Science"
                    }
                });
            }

            if (requestedRole === "student") {
                const user = db.prepare(`
                    SELECT *
                    FROM users
                    WHERE username = ?
                    AND role = 'student'
                `).get(username);

                if (!user) {
                    return res.status(401).json({
                        status: "error",
                        message: "Invalid username or password"
                    });
                }

                const passwordMatch = await bcrypt.compare(password, user.password);
                if (!passwordMatch) {
                    return res.status(401).json({
                        status: "error",
                        message: "Invalid username or password"
                    });
                }

                const student = db.prepare(`
                    SELECT *
                    FROM students
                    WHERE user_id = ?
                `).get(user.id);

                if (!student) {
                    return res.status(404).json({
                        status: "error",
                        message: "Student profile not found"
                    });
                }

                const token = generateToken(user);
                return res.json({
                    status: "success",
                    message: "Student login successful",
                    token,
                    user: {
                        id: user.id,
                        username: user.username,
                        role: user.role
                    },
                    student: {
                        id: student.id,
                        student_id: student.student_id,
                        roll_number: student.roll_number,
                        full_name: student.full_name,
                        department: student.department
                    }
                });
            }

            const adminUser = db.prepare(`
                SELECT *
                FROM users
                WHERE username = ?
                AND role IN ('admin', 'superadmin')
            `).get(username);

            if (adminUser) {
                if (adminUser.username !== ALLOWED_ADMIN_USERNAME) {
                    return res.status(401).json({
                        status: "error",
                        message: "Invalid admin credentials"
                    });
                }

                const passwordMatch = await bcrypt.compare(password, adminUser.password);
                if (passwordMatch) {
                    const token = generateToken(adminUser);
                    return res.json({
                        status: "success",
                        message: "Admin login successful",
                        token,
                        user: {
                            id: adminUser.id,
                            username: adminUser.username,
                            role: adminUser.role
                        }
                    });
                }
            }

            const facultyUser = db.prepare(`
                SELECT *
                FROM users
                WHERE username = ?
                AND role = 'faculty'
            `).get(username);

            if (facultyUser) {
                const passwordMatch = await bcrypt.compare(password, facultyUser.password);
                if (passwordMatch) {
                    const faculty = db.prepare(`
                        SELECT *
                        FROM faculty
                        WHERE user_id = ?
                    `).get(facultyUser.id);

                    const token = generateToken(facultyUser);
                    return res.json({
                        status: "success",
                        message: "Faculty login successful",
                        token,
                        user: {
                            id: facultyUser.id,
                            username: facultyUser.username,
                            role: facultyUser.role
                        },
                        faculty: faculty || {
                            id: null,
                            faculty_id: "FAC-1001",
                            full_name: "Demo Faculty",
                            department: "Computer Science"
                        }
                    });
                }
            }

            const studentUser = db.prepare(`
                SELECT *
                FROM users
                WHERE username = ?
                AND role = 'student'
            `).get(username);

            if (!studentUser) {
                return res.status(401).json({
                    status: "error",
                    message: "Invalid username or password"
                });
            }

            const passwordMatch = await bcrypt.compare(password, studentUser.password);
            if (!passwordMatch) {
                return res.status(401).json({
                    status: "error",
                    message: "Invalid username or password"
                });
            }

            const student = db.prepare(`
                SELECT *
                FROM students
                WHERE user_id = ?
            `).get(studentUser.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const token = generateToken(studentUser);
            return res.json({
                status: "success",
                message: "Student login successful",
                token,
                user: {
                    id: studentUser.id,
                    username: studentUser.username,
                    role: studentUser.role
                },
                student: {
                    id: student.id,
                    student_id: student.student_id,
                    roll_number: student.roll_number,
                    full_name: student.full_name,
                    department: student.department
                }
            });

        } catch (error) {
            console.error("Generic login error:", error);
            return res.status(500).json({
                status: "error",
                message: "Server error during login"
            });
        }
    }
);


// ============================================================
// STUDENT REGISTRATION
// ============================================================

app.post(
    "/api/student/register",
    async (req, res) => {

        try {

            const {

                username,
                password,

                full_name,
                student_id,
                roll_number,

                email,
                mobile,

                dob,
                gender,

                department,
                year,
                section,
                academic_year,

                fee_category,

                parent_name,
                parent_mobile,
                parent_email,

                address,
                city,
                district,
                state,
                pincode,

                profile_photo

            } = req.body;

            const normalizedStudentId = String(roll_number || student_id || "").trim();
            const normalizedRollNumber = String(roll_number || student_id || "").trim();


            // Required fields

            if (
                !username ||
                !password ||
                !full_name ||
                !normalizedStudentId ||
                !email
            ) {

                return res.status(400).json({

                    status: "error",

                    message:
                        "Username, password, full name, roll number and email are required"

                });

            }


            // Check username

            const existingUsername =
                db.prepare(`
                    SELECT id
                    FROM users
                    WHERE username = ?
                `).get(username);


            if (existingUsername) {

                return res.status(409).json({

                    status: "error",

                    message:
                        "Username already exists"

                });

            }


            // Check student ID

            const existingStudent =
                db.prepare(`
                    SELECT id
                    FROM students
                    WHERE student_id = ?
                `).get(normalizedStudentId);


            if (existingStudent) {

                return res.status(409).json({

                    status: "error",

                    message:
                        "Student ID already exists"

                });

            }


            // Hash password

            const hashedPassword =
                await bcrypt.hash(
                    password,
                    10
                );


            // Create user

            const userResult =
                db.prepare(`
                    INSERT INTO users
                    (
                        username,
                        password,
                        role
                    )
                    VALUES (?, ?, 'student')
                `).run(
                    username,
                    hashedPassword
                );


            const userId =
                userResult.lastInsertRowid;


            // Create student

            db.prepare(`
                INSERT INTO students
                (
                    user_id,
                    student_id,
                    roll_number,
                    full_name,
                    email,
                    mobile,
                    dob,
                    gender,
                    department,
                    year,
                    section,
                    academic_year,
                    fee_category,
                    parent_name,
                    parent_mobile,
                    parent_email,
                    address,
                    city,
                    district,
                    state,
                    pincode,
                    profile_photo
                )

                VALUES
                (
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?
                )
            `).run(

                userId,

                normalizedStudentId,
                normalizedRollNumber,

                full_name,

                email,
                mobile || null,

                dob || null,
                gender || null,

                department || null,
                year || null,
                section || null,
                academic_year || null,

                fee_category || null,

                parent_name || null,
                parent_mobile || null,
                parent_email || null,

                address || null,
                city || null,
                district || null,
                state || null,
                pincode || null,

                profile_photo || null

            );


            return res.status(201).json({

                status: "success",

                message:
                    "Student registration successful",

                student_id

            });


        } catch (error) {

            console.error(
                "Student registration error:",
                error
            );


            return res.status(500).json({

                status: "error",

                message:
                    "Student registration failed"

            });

        }

    }
);


// ============================================================
// STUDENT LOGIN
// ============================================================

app.post(
    "/api/faculty/login",
    async (req, res) => {
        try {
            const { username, password } = req.body;

            if (!username || !password) {
                return res.status(400).json({
                    status: "error",
                    message: "Username and password are required"
                });
            }

            const user = db.prepare(`
                SELECT *
                FROM users
                WHERE username = ?
                  AND role = 'faculty'
            `).get(username);

            if (!user) {
                return res.status(401).json({
                    status: "error",
                    message: "Invalid faculty credentials"
                });
            }

            const passwordMatch = await bcrypt.compare(password, user.password);
            if (!passwordMatch) {
                return res.status(401).json({
                    status: "error",
                    message: "Invalid faculty credentials"
                });
            }

            const faculty = db.prepare(`
                SELECT *
                FROM faculty
                WHERE user_id = ?
            `).get(user.id);

            const token = generateToken(user);

            return res.json({
                status: "success",
                message: "Faculty login successful",
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    role: user.role
                },
                faculty: faculty || {
                    id: null,
                    faculty_id: "FAC-1001",
                    full_name: "Demo Faculty",
                    department: "Computer Science"
                }
            });
        } catch (error) {
            console.error("Faculty login error:", error);
            return res.status(500).json({
                status: "error",
                message: "Server error during faculty login"
            });
        }
    }
);

app.get(
    "/api/faculty/dashboard",
    authenticateToken,
    requireFaculty,
    (req, res) => {
        try {
            const faculty = db.prepare(`
                SELECT *
                FROM faculty
                WHERE user_id = ?
            `).get(req.user.id);

            if (!faculty) {
                return res.status(404).json({
                    status: "error",
                    message: "Faculty profile not found"
                });
            }

            const studentCount = db.prepare(`SELECT COUNT(*) AS count FROM students`).get().count;
            const attendanceCount = db.prepare(`SELECT COUNT(*) AS count FROM attendance`).get().count;
            const notificationCount = db.prepare(`SELECT COUNT(*) AS count FROM notifications`).get().count;
            const subjects = db.prepare(`
                SELECT *
                FROM subjects
                WHERE department = ?
                ORDER BY id DESC
                LIMIT 5
            `).all(faculty.department || "Computer Science");

            return res.json({
                status: "success",
                faculty,
                summary: {
                    total_students: Number(studentCount || 0),
                    total_attendance_records: Number(attendanceCount || 0),
                    total_notifications: Number(notificationCount || 0)
                },
                subjects
            });
        } catch (error) {
            console.error("Faculty dashboard error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);

app.post(
    "/api/student/login",
    async (req, res) => {

        try {

            const {
                username,
                password
            } = req.body;


            if (
                !username ||
                !password
            ) {

                return res.status(400).json({

                    status: "error",

                    message:
                        "Username and password are required"

                });

            }


            const user =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE username = ?
                    AND role = 'student'
                `).get(username);


            if (!user) {

                return res.status(401).json({

                    status: "error",

                    message:
                        "Invalid username or password"

                });

            }


            const passwordMatch =
                await bcrypt.compare(
                    password,
                    user.password
                );


            if (!passwordMatch) {

                return res.status(401).json({

                    status: "error",

                    message:
                        "Invalid username or password"

                });

            }


            const student =
                db.prepare(`
                    SELECT *
                    FROM students
                    WHERE user_id = ?
                `).get(user.id);


            if (!student) {

                return res.status(404).json({

                    status: "error",

                    message:
                        "Student profile not found"

                });

            }


            const token =
                generateToken(user);


            return res.json({

                status: "success",

                message:
                    "Student login successful",

                token,

                user: {

                    id: user.id,

                    username: user.username,

                    role: user.role

                },

                student: {

                    id: student.id,

                    student_id:
                        student.student_id,

                    roll_number:
                        student.roll_number,

                    full_name:
                        student.full_name,

                    department:
                        student.department

                }

            });


        } catch (error) {

            console.error(
                "Student login error:",
                error
            );


            return res.status(500).json({

                status: "error",

                message:
                    "Server error during login"

            });

        }

    }
);


// ============================================================
// PARENT LOGIN
// ============================================================

app.post(
    "/api/parent/login",
    async (req, res) => {

        try {

            const {
                student_id: studentId,
                parent_mobile: parentMobile,
                parent_email: parentEmail
            } = req.body;

            if (!studentId || (!parentMobile && !parentEmail)) {
                return res.status(400).json({
                    status: "error",
                    message: "Student ID and parent mobile or email are required"
                });
            }

            const student = db.prepare(`
                SELECT *
                FROM students
                WHERE student_id = ?
                  AND (
                    parent_mobile = ? OR parent_email = ?
                  )
            `).get(
                String(studentId).trim(),
                parentMobile ? String(parentMobile).trim() : null,
                parentEmail ? String(parentEmail).trim() : null
            );

            if (!student) {
                return res.status(401).json({
                    status: "error",
                    message: "Parent credentials do not match any student record"
                });
            }

            const token = jwt.sign(
                {
                    id: student.user_id,
                    role: "parent",
                    parent_name: student.parent_name,
                    student_id: student.student_id
                },
                JWT_SECRET,
                { expiresIn: "1d" }
            );

            return res.json({
                status: "success",
                message: "Parent login successful",
                token,
                student: {
                    id: student.id,
                    student_id: student.student_id,
                    full_name: student.full_name,
                    department: student.department,
                    year: student.year,
                    section: student.section,
                    parent_name: student.parent_name
                }
            });

        } catch (error) {
            console.error("Parent login error:", error);
            return res.status(500).json({
                status: "error",
                message: "Server error during parent login"
            });
        }
    }
);

app.get(
    "/api/parent/dashboard",
    authenticateToken,
    requireParent,
    (req, res) => {
        try {
            const student = db.prepare(`
                SELECT *
                FROM students
                WHERE student_id = ?
            `).get(req.user.student_id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Linked student record not found"
                });
            }

            const feeSummary = db.prepare(`
                SELECT
                    COALESCE(SUM(total_amount), 0) AS total_amount,
                    COALESCE(SUM(paid_amount), 0) AS paid_amount,
                    COALESCE(SUM(pending_amount), 0) AS pending_amount,
                    COUNT(*) AS records
                FROM fees
                WHERE student_id = ?
            `).get(student.id);

            const attendance = db.prepare(`
                SELECT
                    a.id,
                    a.student_id,
                    a.subject AS subject_name,
                    a.subject AS subject_code,
                    a.attendance_date,
                    a.status
                FROM attendance a
                WHERE a.student_id = ?
                ORDER BY a.attendance_date DESC
                LIMIT 20
            `).all(student.id);

            const marks = db.prepare(`
                SELECT
                    m.id,
                    m.student_id,
                    m.subject_id,
                    m.exam_type,
                    m.marks AS total_marks,
                    m.max_marks,
                    COALESCE(s.name, 'Subject ' || m.subject_id) AS subject_name,
                    COALESCE(s.code, 'SUBJ') AS subject_code,
                    COALESCE(m.exam_date, '') AS created_at
                FROM marks m
                LEFT JOIN subjects s ON s.id = m.subject_id
                WHERE m.student_id = ?
                ORDER BY COALESCE(m.exam_date, '') DESC, m.id DESC
                LIMIT 20
            `).all(student.id);

            const notifications = db.prepare(`
                SELECT *
                FROM notifications
                WHERE audience = 'All'
                   OR audience = 'Parents'
                ORDER BY created_at DESC
                LIMIT 20
            `).all();

            return res.json({
                status: "success",
                student,
                feeSummary,
                attendance,
                marks,
                notifications
            });

        } catch (error) {
            console.error("Parent dashboard error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);

app.get(
    "/api/parent/student-profile",
    authenticateToken,
    requireParent,
    (req, res) => {
        try {
            const student = db.prepare(`
                SELECT *
                FROM students
                WHERE student_id = ?
            `).get(req.user.student_id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Linked student record not found"
                });
            }

            const attendance = db.prepare(`
                SELECT
                    a.id,
                    a.student_id,
                    a.subject AS subject_name,
                    a.subject AS subject_code,
                    a.attendance_date,
                    a.status
                FROM attendance a
                WHERE a.student_id = ?
                ORDER BY a.attendance_date DESC
                LIMIT 30
            `).all(student.id);

            const marks = db.prepare(`
                SELECT
                    m.id,
                    m.student_id,
                    m.subject_id,
                    m.exam_type,
                    m.marks AS total_marks,
                    m.max_marks,
                    COALESCE(s.name, 'Subject ' || m.subject_id) AS subject_name,
                    COALESCE(s.code, 'SUBJ') AS subject_code,
                    COALESCE(m.exam_date, '') AS created_at
                FROM marks m
                LEFT JOIN subjects s ON s.id = m.subject_id
                WHERE m.student_id = ?
                ORDER BY COALESCE(m.exam_date, '') DESC, m.id DESC
                LIMIT 30
            `).all(student.id);

            const fees = db.prepare(`
                SELECT *
                FROM fees
                WHERE student_id = ?
                ORDER BY academic_year DESC, fee_year DESC
            `).all(student.id);

            const notifications = db.prepare(`
                SELECT *
                FROM notifications
                WHERE audience = 'All'
                   OR audience = 'Parents'
                ORDER BY created_at DESC
                LIMIT 20
            `).all();

            return res.json({
                status: "success",
                student,
                attendance,
                marks,
                fees,
                notifications
            });

        } catch (error) {
            console.error("Parent student profile error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);


// ============================================================
// ADMIN LOGIN
// ============================================================

app.post(
    "/api/admin/login",
    async (req, res) => {

        try {

            const {
                username,
                password
            } = req.body;


            if (
                !username ||
                !password
            ) {

                return res.status(400).json({

                    status: "error",

                    message:
                        "Username and password are required"

                });

            }


            const user =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE username = ?
                    AND role IN ('admin', 'superadmin')
                `).get(username);


            if (!user) {

                return res.status(401).json({

                    status: "error",

                    message:
                        "Invalid admin credentials"

                });

            }


            const passwordMatch =
                await bcrypt.compare(
                    password,
                    user.password
                );


            if (!passwordMatch) {

                return res.status(401).json({

                    status: "error",

                    message:
                        "Invalid admin credentials"

                });

            }


            const token =
                generateToken(user);


            return res.json({

                status: "success",

                message:
                    "Admin login successful",

                token,

                user: {

                    id: user.id,

                    username:
                        user.username,

                    role:
                        user.role

                }

            });


        } catch (error) {

            console.error(
                "Admin login error:",
                error
            );


            return res.status(500).json({

                status: "error",

                message:
                    "Server error during admin login"

            });

        }

    }
);


// ============================================================
// ADMIN STUDENTS
// ============================================================

app.get(
    "/api/admin/students",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const students = db.prepare(`
                SELECT s.*, u.username
                FROM students s
                LEFT JOIN users u ON u.id = s.user_id
                ORDER BY s.id DESC
            `).all();

            return res.json({
                status: "success",
                count: students.length,
                students
            });

        } catch (error) {

            console.error("Admin students error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }

    }
);

app.get(
    "/api/admin/students/export",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const students = db.prepare(`
                SELECT
                    s.id,
                    s.full_name,
                    s.student_id,
                    s.roll_number,
                    s.email,
                    s.mobile,
                    s.department,
                    s.year,
                    s.section,
                    s.academic_year,
                    s.fee_category,
                    u.username
                FROM students s
                LEFT JOIN users u ON u.id = s.user_id
                ORDER BY s.id DESC
            `).all();

            const workbook = XLSX.utils.book_new();
            const worksheet = XLSX.utils.json_to_sheet(students);
            XLSX.utils.book_append_sheet(workbook, worksheet, "Students");
            const buffer = XLSX.write(workbook, {
                type: "buffer",
                bookType: "xlsx"
            });

            res.setHeader(
                "Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );
            res.setHeader(
                "Content-Disposition",
                "attachment; filename=khit-students.xlsx"
            );

            return res.send(buffer);

        } catch (error) {

            console.error("Student export error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/admin/students/import-preview",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        upload.single("file")(req, res, error => {

            if (error) {
                return res.status(400).json({
                    status: "error",
                    message: "A valid XLSX, XLS, or CSV file under 10 MB is required"
                });
            }

            if (!req.file) {
                return res.status(400).json({
                    status: "error",
                    message: "Import file is required"
                });
            }

            try {

                const workbook = XLSX.readFile(req.file.path, {
                    cellDates: true
                });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(firstSheet, {
                    defval: ""
                });
                const requiredColumns = [
                    "full_name",
                    "student_id",
                    "roll_number",
                    "email"
                ];
                const columns = rows.length ? Object.keys(rows[0]) : [];
                const missingColumns = requiredColumns.filter(
                    column => !columns.includes(column)
                );

                return res.json({
                    status: "success",
                    sheet: workbook.SheetNames[0] || null,
                    total_rows: rows.length,
                    columns,
                    missing_columns: missingColumns,
                    valid_template: missingColumns.length === 0,
                    preview: rows.slice(0, 20)
                });

            } catch (parseError) {

                return res.status(400).json({
                    status: "error",
                    message: "Unable to read the spreadsheet"
                });

            } finally {
                fs.unlink(req.file.path, () => {});
            }
        });
    }
);


// ============================================================
// ADMIN FACULTY
// ============================================================

app.get(
    "/api/admin/faculty",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const faculty = db.prepare(`
                SELECT
                    id,
                    faculty_id,
                    full_name,
                    department,
                    designation,
                    email,
                    mobile,
                    created_at
                FROM faculty
                ORDER BY id DESC
            `).all();

            return res.json({
                status: "success",
                count: faculty.length,
                faculty
            });

        } catch (error) {

            console.error("Admin faculty load error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/admin/faculty",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const {
                faculty_id: facultyId,
                full_name: fullName,
                department,
                designation,
                email,
                mobile
            } = req.body;

            if (!facultyId || !fullName) {
                return res.status(400).json({
                    status: "error",
                    message: "Faculty ID and full name are required"
                });
            }

            const result = db.prepare(`
                INSERT INTO faculty
                    (faculty_id, full_name, department, designation, email, mobile, user_id)
                VALUES (?, ?, ?, ?, ?, ?, NULL)
            `).run(
                facultyId.trim(),
                fullName.trim(),
                department?.trim() || null,
                designation?.trim() || null,
                email?.trim() || null,
                mobile?.trim() || null
            );

            db.prepare(`
                INSERT INTO audit_logs
                    (user_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                req.user.id,
                "CREATE",
                "faculty",
                result.lastInsertRowid,
                JSON.stringify({ facultyId, fullName })
            );

            return res.status(201).json({
                status: "success",
                message: "Faculty record created",
                faculty_id: result.lastInsertRowid
            });

        } catch (error) {

            if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
                return res.status(409).json({
                    status: "error",
                    message: "Faculty ID already exists"
                });
            }

            console.error("Admin faculty create error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.delete(
    "/api/admin/faculty/:id",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const facultyId = Number(req.params.id);
            const result = db.prepare(`
                DELETE FROM faculty
                WHERE id = ?
            `).run(facultyId);

            if (!result.changes) {
                return res.status(404).json({
                    status: "error",
                    message: "Faculty record not found"
                });
            }

            db.prepare(`
                INSERT INTO audit_logs
                    (user_id, action, entity_type, entity_id)
                VALUES (?, ?, ?, ?)
            `).run(req.user.id, "DELETE", "faculty", facultyId);

            return res.json({
                status: "success",
                message: "Faculty record deleted"
            });

        } catch (error) {

            console.error("Admin faculty delete error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);


// ============================================================
// ADMIN FEES
// ============================================================

app.get(
    "/api/admin/fees",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const fees = db.prepare(`
                SELECT
                    f.*,
                    s.full_name,
                    s.student_id AS student_code,
                    s.roll_number
                FROM fees f
                LEFT JOIN students s ON s.id = f.student_id
                ORDER BY f.id DESC
            `).all();

            const summary = db.prepare(`
                SELECT
                    COUNT(*) AS records,
                    COALESCE(SUM(total_amount), 0) AS total_amount,
                    COALESCE(SUM(paid_amount), 0) AS paid_amount,
                    COALESCE(SUM(pending_amount), 0) AS pending_amount
                FROM fees
            `).get();

            return res.json({
                status: "success",
                fees,
                summary
            });

        } catch (error) {

            console.error("Admin fees load error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/admin/fees",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const {
                student_id: studentId,
                academic_year: academicYear,
                fee_year: feeYear,
                total_amount: totalAmount
            } = req.body;

            const numericStudentId = Number(studentId);
            const numericFeeYear = Number(feeYear);
            const numericTotal = Number(totalAmount);

            if (!numericStudentId || !academicYear || !numericFeeYear || !Number.isFinite(numericTotal) || numericTotal < 0) {
                return res.status(400).json({
                    status: "error",
                    message: "Student, academic year, fee year, and a valid total amount are required"
                });
            }

            const student = db.prepare(`
                SELECT id
                FROM students
                WHERE id = ?
            `).get(numericStudentId);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student record not found"
                });
            }

            const result = db.prepare(`
                INSERT INTO fees
                    (student_id, academic_year, fee_year, total_amount, paid_amount, pending_amount, status)
                VALUES (?, ?, ?, ?, 0, ?, 'Pending')
            `).run(
                numericStudentId,
                academicYear.trim(),
                numericFeeYear,
                numericTotal,
                numericTotal
            );

            db.prepare(`
                INSERT INTO audit_logs
                    (user_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                req.user.id,
                "CREATE",
                "fee",
                result.lastInsertRowid,
                JSON.stringify({ studentId: numericStudentId, academicYear, feeYear, totalAmount: numericTotal })
            );

            return res.status(201).json({
                status: "success",
                message: "Fee record created",
                fee_id: result.lastInsertRowid
            });

        } catch (error) {

            console.error("Admin fee create error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.delete(
    "/api/admin/fees/:id",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const feeId = Number(req.params.id);
            const result = db.prepare(`
                DELETE FROM fees
                WHERE id = ?
            `).run(feeId);

            if (!result.changes) {
                return res.status(404).json({
                    status: "error",
                    message: "Fee record not found"
                });
            }

            db.prepare(`
                INSERT INTO audit_logs
                    (user_id, action, entity_type, entity_id)
                VALUES (?, ?, ?, ?)
            `).run(req.user.id, "DELETE", "fee", feeId);

            return res.json({
                status: "success",
                message: "Fee record deleted"
            });

        } catch (error) {

            console.error("Admin fee delete error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);


// ============================================================
// ADMIN BUS MANAGEMENT
// ============================================================

app.get(
    "/api/admin/buses",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const buses = db.prepare(`
                SELECT *
                FROM buses
                ORDER BY id DESC
            `).all();

            const stops = db.prepare(`
                SELECT *
                FROM bus_stops
                ORDER BY bus_id, id
            `).all();

            return res.json({
                status: "success",
                buses,
                stops
            });

        } catch (error) {

            console.error("Admin buses load error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/admin/buses",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const busNumber = String(req.body.bus_number || "").trim();
            const routeName = String(req.body.route_name || "").trim();

            if (!busNumber) {
                return res.status(400).json({
                    status: "error",
                    message: "Bus number is required"
                });
            }

            const result = db.prepare(`
                INSERT INTO buses (bus_number, route_name, status)
                VALUES (?, ?, 'Active')
            `).run(busNumber, routeName || null);

            db.prepare(`
                INSERT INTO audit_logs
                    (user_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                req.user.id,
                "CREATE",
                "bus",
                result.lastInsertRowid,
                JSON.stringify({ busNumber, routeName })
            );

            return res.status(201).json({
                status: "success",
                message: "Bus created",
                bus_id: result.lastInsertRowid
            });

        } catch (error) {

            if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
                return res.status(409).json({
                    status: "error",
                    message: "Bus number already exists"
                });
            }

            console.error("Admin bus create error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/admin/buses/:id/stops",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const busId = Number(req.params.id);
            const stopName = String(req.body.stop_name || "").trim();
            const pickupTime = String(req.body.pickup_time || "").trim();

            if (!busId || !stopName) {
                return res.status(400).json({
                    status: "error",
                    message: "Bus and stop name are required"
                });
            }

            const bus = db.prepare("SELECT id FROM buses WHERE id = ?").get(busId);
            if (!bus) {
                return res.status(404).json({
                    status: "error",
                    message: "Bus not found"
                });
            }

            const result = db.prepare(`
                INSERT INTO bus_stops (bus_id, stop_name, pickup_time)
                VALUES (?, ?, ?)
            `).run(busId, stopName, pickupTime || null);

            return res.status(201).json({
                status: "success",
                message: "Bus stop created",
                stop_id: result.lastInsertRowid
            });

        } catch (error) {

            console.error("Admin bus stop create error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.delete(
    "/api/admin/buses/:id",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const busId = Number(req.params.id);
            const result = db.prepare("DELETE FROM buses WHERE id = ?").run(busId);

            if (!result.changes) {
                return res.status(404).json({
                    status: "error",
                    message: "Bus not found"
                });
            }

            db.prepare(`
                INSERT INTO audit_logs (user_id, action, entity_type, entity_id)
                VALUES (?, ?, ?, ?)
            `).run(req.user.id, "DELETE", "bus", busId);

            return res.json({
                status: "success",
                message: "Bus deleted"
            });

        } catch (error) {

            console.error("Admin bus delete error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);


// ============================================================
// ADMIN EVENTS AND ANNOUNCEMENTS
// ============================================================

app.get(
    "/api/admin/events",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const events = db.prepare(`
                SELECT *
                FROM events
                ORDER BY event_date DESC, id DESC
            `).all();

            const announcements = db.prepare(`
                SELECT *
                FROM announcements
                ORDER BY id DESC
            `).all();

            return res.json({
                status: "success",
                events,
                announcements
            });

        } catch (error) {

            console.error("Admin events load error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/admin/events",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const title = String(req.body.title || "").trim();
            const description = String(req.body.description || "").trim();
            const eventDate = String(req.body.event_date || "").trim();
            const eventTime = String(req.body.event_time || "").trim();
            const venue = String(req.body.venue || "").trim();
            const category = String(req.body.category || "General").trim();
            const audience = String(req.body.audience || "All").trim();

            if (!title) {
                return res.status(400).json({
                    status: "error",
                    message: "Event title is required"
                });
            }

            const result = db.prepare(`
                INSERT INTO events
                    (title, description, event_date, event_time, venue, category, audience, published)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0)
            `).run(
                title,
                description || null,
                eventDate || null,
                eventTime || null,
                venue || null,
                category,
                audience
            );

            db.prepare(`
                INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?)
            `).run(req.user.id, "CREATE", "event", result.lastInsertRowid, JSON.stringify({ title }));

            return res.status(201).json({
                status: "success",
                message: "Event created",
                event_id: result.lastInsertRowid
            });

        } catch (error) {

            console.error("Admin event create error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.patch(
    "/api/admin/events/:id/publish",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const eventId = Number(req.params.id);
            const published = req.body.published ? 1 : 0;
            const result = db.prepare(`
                UPDATE events
                SET published = ?
                WHERE id = ?
            `).run(published, eventId);

            if (!result.changes) {
                return res.status(404).json({
                    status: "error",
                    message: "Event not found"
                });
            }

            return res.json({
                status: "success",
                message: published ? "Event published" : "Event unpublished"
            });

        } catch (error) {

            console.error("Admin event publish error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.delete(
    "/api/admin/events/:id",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const eventId = Number(req.params.id);
            const result = db.prepare("DELETE FROM events WHERE id = ?").run(eventId);

            if (!result.changes) {
                return res.status(404).json({
                    status: "error",
                    message: "Event not found"
                });
            }

            db.prepare(`
                INSERT INTO audit_logs (user_id, action, entity_type, entity_id)
                VALUES (?, ?, ?, ?)
            `).run(req.user.id, "DELETE", "event", eventId);

            return res.json({
                status: "success",
                message: "Event deleted"
            });

        } catch (error) {

            console.error("Admin event delete error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/admin/announcements",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const title = String(req.body.title || "").trim();
            const description = String(req.body.description || "").trim();
            const audience = String(req.body.audience || "All Students").trim();

            if (!title) {
                return res.status(400).json({
                    status: "error",
                    message: "Announcement title is required"
                });
            }

            const result = db.prepare(`
                INSERT INTO announcements (title, description, audience, published)
                VALUES (?, ?, ?, 0)
            `).run(title, description || null, audience);

            return res.status(201).json({
                status: "success",
                message: "Announcement created",
                announcement_id: result.lastInsertRowid
            });

        } catch (error) {

            console.error("Admin announcement create error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);


// ============================================================
// ADMIN DASHBOARD STATISTICS
// ============================================================

app.get(
    "/api/admin/stats",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const counts = db.prepare(`
                SELECT
                    (SELECT COUNT(*) FROM students) AS students,
                    (SELECT COUNT(*) FROM faculty) AS faculty,
                    (SELECT COUNT(*) FROM notifications) AS notifications,
                    (SELECT COUNT(*) FROM events) AS events,
                    (SELECT COUNT(*) FROM fees) AS fees
            `).get();

            return res.json({
                status: "success",
                stats: {
                    students: Number(counts.students || 0),
                    faculty: Number(counts.faculty || 0),
                    notifications: Number(counts.notifications || 0),
                    events: Number(counts.events || 0),
                    fees: Number(counts.fees || 0)
                }
            });

        } catch (error) {

            console.error("Admin statistics error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }

    }
);

app.get(
    "/api/admin/reports",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        try {
            const summary = db.prepare(`
                SELECT
                    (SELECT COUNT(*) FROM students) AS students,
                    (SELECT COUNT(*) FROM faculty) AS faculty,
                    (SELECT COUNT(*) FROM notifications) AS notifications,
                    (SELECT COUNT(*) FROM events) AS events,
                    (SELECT COALESCE(SUM(total_amount), 0) FROM fees) AS fee_total,
                    (SELECT COALESCE(SUM(paid_amount), 0) FROM fees) AS fee_paid,
                    (SELECT COALESCE(SUM(pending_amount), 0) FROM fees) AS fee_pending,
                    (SELECT COUNT(*) FROM attendance WHERE status = 'Present') AS attendance_present,
                    (SELECT COUNT(*) FROM attendance WHERE status = 'Absent') AS attendance_absent,
                    (SELECT COUNT(*) FROM attendance WHERE status = 'Leave') AS attendance_leave
            `).get();

            const departmentBreakdown = db.prepare(`
                SELECT department,
                       COUNT(*) AS total_students
                FROM students
                WHERE department IS NOT NULL AND TRIM(department) != ''
                GROUP BY department
                ORDER BY total_students DESC, department ASC
            `).all();

            const feeStatusBreakdown = db.prepare(`
                SELECT status,
                       COUNT(*) AS total_records
                FROM fees
                GROUP BY status
                ORDER BY total_records DESC, status ASC
            `).all();

            const recentAnnouncements = db.prepare(`
                SELECT title,
                       message,
                       created_at
                FROM notifications
                ORDER BY created_at DESC
                LIMIT 5
            `).all();

            return res.json({
                status: "success",
                summary: {
                    students: Number(summary.students || 0),
                    faculty: Number(summary.faculty || 0),
                    notifications: Number(summary.notifications || 0),
                    events: Number(summary.events || 0),
                    fee_total: Number(summary.fee_total || 0),
                    fee_paid: Number(summary.fee_paid || 0),
                    fee_pending: Number(summary.fee_pending || 0),
                    attendance_present: Number(summary.attendance_present || 0),
                    attendance_absent: Number(summary.attendance_absent || 0),
                    attendance_leave: Number(summary.attendance_leave || 0)
                },
                departmentBreakdown,
                feeStatusBreakdown,
                recentAnnouncements
            });

        } catch (error) {
            console.error("Admin reports error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);


// ============================================================
// STUDENT PROFILE
// ============================================================

app.get(
    "/api/student/profile",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const student =
                db.prepare(`
                    SELECT
                        *
                    FROM students
                    WHERE user_id = ?
                `).get(req.user.id);


            if (!student) {

                return res.status(404).json({

                    status: "error",

                    message:
                        "Student profile not found"

                });

            }


            return res.json({

                status: "success",

                student

            });


        } catch (error) {

            console.error(
                "Profile error:",
                error
            );


            return res.status(500).json({

                status: "error",

                message:
                    "Unable to load profile"

            });

        }

    }
);

app.patch(
    "/api/student/profile",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const student = db.prepare(`
                SELECT *
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const allowedFields = [
                "full_name",
                "email",
                "mobile",
                "dob",
                "gender",
                "department",
                "year",
                "section",
                "academic_year",
                "fee_category",
                "parent_name",
                "parent_mobile",
                "parent_email",
                "address",
                "city",
                "district",
                "state",
                "pincode",
                "profile_photo",
                "linkedin_url",
                "github_url",
                "portfolio_url"
            ];

            const payload = req.body || {};
            const updates = {};

            allowedFields.forEach((field) => {
                if (Object.prototype.hasOwnProperty.call(payload, field)) {
                    const value = payload[field];
                    updates[field] = value === "" || value === null || value === undefined ? null : String(value).trim();
                }
            });

            if (Object.keys(updates).length === 0) {
                return res.status(400).json({
                    status: "error",
                    message: "No valid profile fields supplied"
                });
            }

            const sql = [
                "UPDATE students SET"
            ];
            const params = [];

            Object.entries(updates).forEach(([field, value], index) => {
                sql.push(`${field} = ?` + (index < Object.keys(updates).length - 1 ? "," : ""));
                params.push(value);
            });

            sql.push("WHERE user_id = ?");
            params.push(req.user.id);

            db.prepare(sql.join(" ")).run(...params);

            db.prepare(`
                INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                req.user.id,
                "UPDATE_PROFILE",
                "student",
                student.id,
                JSON.stringify({ updatedFields: Object.keys(updates) })
            );

            const updatedStudent = db.prepare(`
                SELECT *
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            return res.json({
                status: "success",
                message: "Profile updated successfully",
                student: updatedStudent
            });

        } catch (error) {
            console.error("Profile update error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message || "Unable to update profile"
            });
        }
    }
);


// ============================================================
// STUDENT ACADEMIC RECORDS
// ============================================================

app.get(
    "/api/student/academics",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const student = db.prepare(`
                SELECT id, department, year, section
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const subjects = db.prepare(`
                SELECT id, code, name, department, year, semester, section
                FROM subjects
                WHERE (department IS NULL OR department = ?)
                  AND (year IS NULL OR year = ?)
                  AND (section IS NULL OR section = ?)
                ORDER BY semester, code, name
            `).all(student.department, student.year, student.section);

            return res.json({
                status: "success",
                subjects
            });

        } catch (error) {

            console.error("Student academics error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/student/fees",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const student = db.prepare(`
                SELECT id, year
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const fees = db.prepare(`
                SELECT *
                FROM fees
                WHERE student_id = ?
                ORDER BY fee_year DESC, id DESC
            `).all(student.id);

            const payments = db.prepare(`
                SELECT *
                FROM fee_payments
                WHERE student_id = ?
                ORDER BY payment_date DESC, id DESC
            `).all(student.id);

            return res.json({
                status: "success",
                student: {
                    year: student.year
                },
                fees,
                payments,
                summary: {
                    total: fees.reduce((sum, fee) => sum + Number(fee.total_amount || 0), 0),
                    paid: fees.reduce((sum, fee) => sum + Number(fee.paid_amount || 0), 0),
                    pending: fees.reduce((sum, fee) => sum + Number(fee.pending_amount || 0), 0)
                }
            });

        } catch (error) {

            console.error("Student fees error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/student/fees/pay",
    authenticateToken,
    requireStudent,
    (req, res) => {
        try {
            const student = db.prepare(`
                SELECT id, year
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const feeId = Number(req.body.fee_id);
            const amount = Number(req.body.amount);
            const method = String(req.body.method || "Online").trim();
            const transactionId = String(req.body.transaction_id || "TXN-" + Date.now()).trim();

            if (!Number.isFinite(feeId) || feeId <= 0) {
                return res.status(400).json({
                    status: "error",
                    message: "A valid fee record is required"
                });
            }

            if (!Number.isFinite(amount) || amount <= 0) {
                return res.status(400).json({
                    status: "error",
                    message: "Payment amount must be greater than 0"
                });
            }

            const fee = db.prepare(`
                SELECT *
                FROM fees
                WHERE id = ? AND student_id = ?
            `).get(feeId, student.id);

            if (!fee) {
                return res.status(404).json({
                    status: "error",
                    message: "Fee record not found"
                });
            }

            const currentYear = Math.min(4, Math.max(1, Number(student.year) || 1));
            if (Number(fee.fee_year) > currentYear) {
                return res.status(400).json({
                    status: "error",
                    message: "This fee year is locked until your current academic year is completed"
                });
            }

            const previousYears = db.prepare(`
                SELECT fee_year, pending_amount, status
                FROM fees
                WHERE student_id = ? AND fee_year < ?
            `).all(student.id, fee.fee_year);
            const previousYearComplete = Array.from(
                { length: Math.max(0, Number(fee.fee_year) - 1) },
                (_, index) => index + 1
            ).every(year => {
                const previousFee = previousYears.find(item => Number(item.fee_year) === year);
                return previousFee && (
                    Number(previousFee.pending_amount || 0) <= 0 ||
                    String(previousFee.status || '').toLowerCase() === "paid"
                );
            });

            if (!previousYearComplete) {
                return res.status(400).json({
                    status: "error",
                    message: "Complete all previous fee years before paying this fee year"
                });
            }

            const pendingAmount = Number(fee.pending_amount || 0);
            if (amount > pendingAmount && pendingAmount > 0) {
                return res.status(400).json({
                    status: "error",
                    message: `Amount exceeds remaining balance. Remaining balance is ${pendingAmount}`
                });
            }

            const nextPaid = Number(fee.paid_amount || 0) + amount;
            const nextPending = Math.max(Number(fee.total_amount || 0) - nextPaid, 0);
            const nextStatus = nextPending > 0 ? "Pending" : "Paid";

            db.prepare(`
                INSERT INTO fee_payments
                    (student_id, amount, payment_mode, transaction_id, payment_reference, payment_date)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
            `).run(student.id, amount, method, transactionId, `fee_${feeId}`);

            db.prepare(`
                UPDATE fees
                SET paid_amount = ?, pending_amount = ?, status = ?
                WHERE id = ?
            `).run(nextPaid, nextPending, nextStatus, feeId);

            db.prepare(`
                INSERT INTO audit_logs
                    (user_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                req.user.id,
                "PAYMENT",
                "fee",
                feeId,
                JSON.stringify({
                    fee_id: feeId,
                    amount,
                    method,
                    transaction_id: transactionId,
                    paid_at: new Date().toISOString()
                })
            );

            return res.status(201).json({
                status: "success",
                message: "Fee payment recorded successfully",
                payment: {
                    fee_id: feeId,
                    amount,
                    method,
                    transaction_id: transactionId,
                    remaining_balance: nextPending,
                    status: nextStatus
                }
            });

        } catch (error) {
            console.error("Student fee payment error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);

app.get(
    "/api/student/bus",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const assignment = db.prepare(`
                SELECT
                    a.*,
                    b.bus_number,
                    b.route_name,
                    b.status AS bus_status,
                    s.stop_name,
                    s.pickup_time
                FROM student_bus_assignments a
                LEFT JOIN buses b ON b.id = a.bus_id
                LEFT JOIN bus_stops s ON s.id = a.stop_id
                JOIN students st ON st.id = a.student_id
                WHERE st.user_id = ?
                ORDER BY a.id DESC
                LIMIT 1
            `).get(req.user.id);

            return res.json({
                status: "success",
                assignment: assignment || null
            });

        } catch (error) {

            console.error("Student bus error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/student/assignments",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const assignments = db.prepare(`
                SELECT
                    a.id,
                    a.title,
                    a.description,
                    a.due_date,
                    a.attachment_url,
                    s.name AS subject_name,
                    sub.submitted_at,
                    sub.marks,
                    sub.remarks
                FROM assignments a
                LEFT JOIN subjects s ON s.id = a.subject_id
                LEFT JOIN assignment_submissions sub
                    ON sub.assignment_id = a.id
                    AND sub.student_id = (SELECT id FROM students WHERE user_id = ?)
                WHERE s.id IS NULL
                   OR (s.department = (SELECT department FROM students WHERE user_id = ?)
                       AND (s.year IS NULL OR s.year = (SELECT year FROM students WHERE user_id = ?))
                       AND (s.section IS NULL OR s.section = (SELECT section FROM students WHERE user_id = ?)))
                ORDER BY a.due_date, a.id DESC
            `).all(req.user.id, req.user.id, req.user.id, req.user.id);

            return res.json({
                status: "success",
                assignments
            });

        } catch (error) {

            console.error("Student assignments error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/student/documents",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const documents = db.prepare(`
                SELECT
                    id,
                    document_name,
                    document_type,
                    file_url,
                    uploaded_at
                FROM documents
                WHERE user_id = ?
                ORDER BY uploaded_at DESC, id DESC
            `).all(req.user.id);

            return res.json({
                status: "success",
                documents
            });

        } catch (error) {

            console.error("Student documents error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/student/placements",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const student = db.prepare(`
                SELECT id
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            const drives = db.prepare(`
                SELECT
                    d.*,
                    p.status AS application_status,
                    p.applied_at
                FROM placement_drives d
                LEFT JOIN placement_applications p
                    ON p.drive_id = d.id
                    AND p.student_id = ?
                WHERE d.status = 'Open'
                ORDER BY d.drive_date, d.id DESC
            `).all(student?.id || 0);

            return res.json({
                status: "success",
                drives
            });

        } catch (error) {

            console.error("Student placements error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/student/internships",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const internships = db.prepare(`
                SELECT *
                FROM internships
                WHERE status = 'Open'
                ORDER BY application_deadline, id DESC
            `).all();

            return res.json({
                status: "success",
                internships
            });

        } catch (error) {

            console.error("Student internships error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/student/materials",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const student = db.prepare(`
                SELECT department, year, section
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const materials = db.prepare(`
                SELECT *
                FROM study_materials
                WHERE (department IS NULL OR department = ?)
                  AND (year IS NULL OR year = ?)
                  AND (section IS NULL OR section = ?)
                ORDER BY created_at DESC, id DESC
            `).all(student.department, student.year, student.section);

            return res.json({
                status: "success",
                materials
            });

        } catch (error) {

            console.error("Student materials error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/admin/materials",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const title = String(req.body.title || "").trim();
            const description = String(req.body.description || "").trim();
            const materialType = String(req.body.material_type || "Document").trim();
            const fileUrl = String(req.body.file_url || "").trim();
            const subject = String(req.body.subject || "").trim();
            const department = String(req.body.department || "").trim();
            const year = req.body.year ? Number(req.body.year) : null;
            const section = String(req.body.section || "").trim();

            if (!title) {
                return res.status(400).json({
                    status: "error",
                    message: "Material title is required"
                });
            }

            const result = db.prepare(`
                INSERT INTO study_materials
                    (title, description, material_type, file_url, subject, department, year, section, uploaded_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                title,
                description || null,
                materialType,
                fileUrl || null,
                subject || null,
                department || null,
                year,
                section || null,
                req.user.id
            );

            return res.status(201).json({
                status: "success",
                material_id: result.lastInsertRowid
            });

        } catch (error) {

            console.error("Admin material create error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/student/leave-requests",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const requests = db.prepare(`
                SELECT
                    lr.id,
                    lr.from_date AS starts_on,
                    lr.to_date AS ends_on,
                    lr.reason,
                    lr.status,
                    lr.response,
                    lr.created_at
                FROM leave_requests lr
                JOIN students s ON s.id = lr.student_id
                WHERE s.user_id = ?
                ORDER BY lr.created_at DESC, lr.id DESC
            `).all(req.user.id);

            return res.json({
                status: "success",
                requests
            });

        } catch (error) {

            console.error("Student leave load error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/student/leave-requests",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const startsOn = String(req.body.starts_on || "").trim();
            const endsOn = String(req.body.ends_on || "").trim();
            const reason = String(req.body.reason || "").trim();

            if (!startsOn || !endsOn || !reason) {
                return res.status(400).json({
                    status: "error",
                    message: "Start date, end date, and reason are required"
                });
            }

            const student = db.prepare(`
                SELECT id
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const result = db.prepare(`
                INSERT INTO leave_requests (student_id, from_date, to_date, reason, status)
                VALUES (?, ?, ?, ?, 'Pending')
            `).run(student.id, startsOn, endsOn, reason);

            return res.status(201).json({
                status: "success",
                message: "Leave request submitted",
                request_id: result.lastInsertRowid
            });

        } catch (error) {

            console.error("Student leave create error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/admin/leave-requests",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const requests = db.prepare(`
                SELECT
                    lr.*,
                    s.full_name,
                    s.student_id AS student_code,
                    s.department,
                    s.year,
                    s.section
                FROM leave_requests lr
                LEFT JOIN students s ON s.id = lr.student_id
                ORDER BY lr.created_at DESC, lr.id DESC
            `).all();

            return res.json({
                status: "success",
                requests
            });

        } catch (error) {

            console.error("Admin leave load error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.patch(
    "/api/admin/leave-requests/:id/review",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const requestId = Number(req.params.id);
            const status = String(req.body.status || "").trim();
            const response = String(req.body.response || "").trim();

            if (!['Approved', 'Rejected', 'Clarification'].includes(status)) {
                return res.status(400).json({
                    status: "error",
                    message: "Review status must be Approved, Rejected, or Clarification"
                });
            }

            const result = db.prepare(`
                UPDATE leave_requests
                SET status = ?, response = ?
                WHERE id = ?
            `).run(status, response || null, requestId);

            if (!result.changes) {
                return res.status(404).json({
                    status: "error",
                    message: "Leave request not found"
                });
            }

            db.prepare(`
                INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?)
            `).run(req.user.id, "REVIEW", "leave_request", requestId, JSON.stringify({ status }));

            return res.json({
                status: "success",
                message: `Leave request ${status.toLowerCase()}`
            });

        } catch (error) {

            console.error("Admin leave review error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/student/exams",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const student = db.prepare(`
                SELECT id
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const results = db.prepare(`
                SELECT
                    m.id,
                    m.exam_type,
                    m.marks,
                    m.max_marks,
                    m.exam_date,
                    s.code AS subject_code,
                    s.name AS subject_name
                FROM marks m
                LEFT JOIN subjects s ON s.id = m.subject_id
                WHERE m.student_id = ?
                ORDER BY m.exam_date DESC, m.id DESC
            `).all(student.id);

            return res.json({
                status: "success",
                results
            });

        } catch (error) {

            console.error("Student exams error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/student/attendance",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const student = db.prepare(`
                SELECT id
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const subjectWise = db.prepare(`
                SELECT
                    subject,
                    COUNT(*) AS conducted,
                    SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS present,
                    SUM(CASE WHEN status = 'Absent' THEN 1 ELSE 0 END) AS absent
                FROM attendance
                WHERE student_id = ?
                GROUP BY subject
                ORDER BY subject
            `).all(student.id).map(item => ({
                ...item,
                percentage: item.conducted
                    ? Number(((item.present / item.conducted) * 100).toFixed(2))
                    : 0
            }));

            const summary = db.prepare(`
                SELECT
                    COUNT(*) AS conducted,
                    SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS present,
                    SUM(CASE WHEN status = 'Absent' THEN 1 ELSE 0 END) AS absent
                FROM attendance
                WHERE student_id = ?
            `).get(student.id);

            return res.json({
                status: "success",
                summary: {
                    conducted: Number(summary.conducted || 0),
                    present: Number(summary.present || 0),
                    absent: Number(summary.absent || 0),
                    percentage: summary.conducted
                        ? Number(((summary.present / summary.conducted) * 100).toFixed(2))
                        : 0
                },
                subject_wise: subjectWise
            });

        } catch (error) {

            console.error("Student attendance error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/student/marks",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const student = db.prepare(`
                SELECT id
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const marks = db.prepare(`
                SELECT
                    m.id,
                    m.exam_type,
                    m.marks,
                    m.max_marks,
                    m.exam_date,
                    s.code AS subject_code,
                    s.name AS subject_name
                FROM marks m
                LEFT JOIN subjects s ON s.id = m.subject_id
                WHERE m.student_id = ?
                ORDER BY m.exam_date DESC, m.id DESC
            `).all(student.id);

            return res.json({
                status: "success",
                marks
            });

        } catch (error) {

            console.error("Student marks error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);


// ============================================================
// STUDENT NOTIFICATIONS
// ============================================================

app.get(
    "/api/student/notifications",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const student = db.prepare(`
                SELECT *
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const notifications = db.prepare(`
                SELECT
                    n.id,
                    n.title,
                    n.message,
                    n.audience,
                    n.branch,
                    n.year,
                    n.section,
                    n.created_at,
                    CASE
                        WHEN nr.id IS NOT NULL THEN 1
                        ELSE 0
                    END AS is_read
                FROM notifications n
                LEFT JOIN notification_reads nr
                    ON nr.notification_id = n.id
                    AND nr.student_id = ?
                WHERE (
                    n.audience = 'All'
                    OR n.audience = 'All Students'
                    OR (n.audience = 'Branch' AND n.branch = ?)
                    OR (n.audience = 'Year' AND n.year = ?)
                    OR (n.audience = 'Section' AND n.section = ?)
                    OR (n.audience = 'Branch + Year' AND n.branch = ? AND n.year = ?)
                    OR (n.audience = 'Branch + Section' AND n.branch = ? AND n.section = ?)
                    OR (n.audience = 'Year + Section' AND n.year = ? AND n.section = ?)
                )
                ORDER BY n.created_at DESC
            `).all(
                student.id,
                student.department,
                student.year,
                student.section,
                student.department,
                student.year,
                student.department,
                student.section,
                student.year,
                student.section
            );

            return res.json({
                status: "success",
                count: notifications.length,
                unread_count: notifications.filter((notification) => Number(notification.is_read) === 0).length,
                notifications
            });

        } catch (error) {
            console.error("Student notifications error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);

app.get(
    "/api/student/notifications/unread-count",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const student = db.prepare(`
                SELECT *
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const result = db.prepare(`
                SELECT COUNT(*) AS unread_count
                FROM notifications n
                LEFT JOIN notification_reads nr
                    ON nr.notification_id = n.id
                    AND nr.student_id = ?
                WHERE nr.id IS NULL
                  AND (
                    n.audience = 'All'
                    OR n.audience = 'All Students'
                    OR (n.audience = 'Branch' AND n.branch = ?)
                    OR (n.audience = 'Year' AND n.year = ?)
                    OR (n.audience = 'Section' AND n.section = ?)
                    OR (n.audience = 'Branch + Year' AND n.branch = ? AND n.year = ?)
                    OR (n.audience = 'Branch + Section' AND n.branch = ? AND n.section = ?)
                    OR (n.audience = 'Year + Section' AND n.year = ? AND n.section = ?)
                  )
            `).get(
                student.id,
                student.department,
                student.year,
                student.section,
                student.department,
                student.year,
                student.department,
                student.section,
                student.year,
                student.section
            );

            return res.json({
                status: "success",
                unread_count: Number(result.unread_count || 0)
            });

        } catch (error) {
            console.error("Unread Count Error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);

app.patch(
    "/api/student/notifications/:id/read",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const notificationId = Number(req.params.id);
            const student = db.prepare(`
                SELECT id
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const existing = db.prepare(`
                SELECT id
                FROM notification_reads
                WHERE notification_id = ?
                  AND student_id = ?
            `).get(notificationId, student.id);

            if (!existing) {
                db.prepare(`
                    INSERT INTO notification_reads (notification_id, student_id)
                    VALUES (?, ?)
                `).run(notificationId, student.id);
            }

            return res.json({
                status: "success",
                message: "Notification marked as read"
            });

        } catch (error) {
            console.error("Mark notification read error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);

// ============================================================
// ADMIN NOTIFICATIONS
// ============================================================

app.get(
    "/api/admin/notifications",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        try {
            const notifications = db.prepare(`
                SELECT *
                FROM notifications
                ORDER BY created_at DESC
            `).all();

            return res.json({
                status: "success",
                notifications
            });
        } catch (error) {
            console.error("Admin notifications load error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);

app.post(
    "/api/admin/notifications",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        try {
            const { title, message, audience, branch, year, section } = req.body;

            if (!title) {
                return res.status(400).json({
                    status: "error",
                    message: "Notification title is required"
                });
            }

            const result = db.prepare(`
                INSERT INTO notifications (title, message, audience, branch, year, section)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(
                title,
                message || "",
                audience || "All",
                branch || null,
                year ? Number(year) : null,
                section || null
            );

            return res.status(201).json({
                status: "success",
                message: "Notification published successfully",
                notification_id: result.lastInsertRowid
            });
        } catch (error) {
            console.error("Admin notifications create error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);

app.delete(
    "/api/admin/notifications/:id",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        try {
            const id = Number(req.params.id);
            const result = db.prepare(`
                DELETE FROM notifications
                WHERE id = ?
            `).run(id);

            if (result.changes === 0) {
                return res.status(404).json({
                    status: "error",
                    message: "Notification not found"
                });
            }

            return res.json({
                status: "success",
                message: "Notification deleted successfully"
            });
        } catch (error) {
            console.error("Admin notifications delete error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);

app.listen(PORT, () => {
    console.log("\n==========================================");
    console.log(" KHIT FAMILY PORTAL SERVER");
    console.log("==========================================");
    console.log(` Server: http://localhost:${PORT}`);
    console.log(` API:    http://localhost:${PORT}/api/status`);
    console.log("==========================================\n");
});
