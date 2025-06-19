const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Joi = require('joi');

// Connection string MongoDB Atlas (sesuaikan dengan milik Anda)
const uri = 'mongodb+srv://intancahyafadila59:ebDIcFvBg532mFxX@cluster0.mve4tmi.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

// Inisialisasi client MongoDB
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
    tlsAllowInvalidCertificates: true,
});

const SECRET = process.env.JWT_SECRET || 'supersecret';

async function startServer() {
    try {
        // 1) Koneksi ke MongoDB
        await client.connect();
        console.log('✅  Berhasil terhubung ke MongoDB Atlas');

        // 2) Siapkan collection yang akan diakses
        const db = client.db('sample_mflix');
        const moviesCollection = db.collection('movies');
        const complaintsCollection = db.collection('complaints');
        const usersCol = db.collection('users');

        // 3) Buat aplikasi Express
        const app = express();
        const PORT = process.env.PORT || 3001;

        // Middleware
        app.use(cors());
        app.use(express.json());

        // 4) Endpoint health check
        app.get('/api/health', (req, res) => {
            res.json({ status: 'ok', timestamp: new Date().toISOString() });
        });

        // 5) Endpoint untuk mengambil 20 film pertama
        app.get('/api/movies', async (req, res) => {
            try {
                const movies = await moviesCollection
                    .find({})
                    .limit(20)
                    .project({ title: 1, year: 1, plot: 1, genres: 1, rated: 1, cast: 1, _id: 0 })
                    .toArray();
                res.json({ count: movies.length, data: movies });
            } catch (err) {
                console.error('❌  Error mengambil data movies:', err);
                res.status(500).json({ error: 'Gagal mengambil data' });
            }
        });

        // 6) Endpoint pencarian film berdasarkan judul
        app.get('/api/movies/search', async (req, res) => {
            const { title } = req.query;
            if (!title) {
                return res.status(400).json({ error: 'Parameter "title" wajib diisi' });
            }
            try {
                const movies = await moviesCollection
                    .find({ title: { $regex: title, $options: 'i' } })
                    .limit(20)
                    .project({ title: 1, year: 1, plot: 1, genres: 1, rated: 1, cast: 1, _id: 0 })
                    .toArray();
                res.json({ count: movies.length, data: movies });
            } catch (err) {
                console.error('❌  Error mencari movies:', err);
                res.status(500).json({ error: 'Gagal mencari data' });
            }
        });

        // 7) Endpoint untuk membuat pengaduan
        app.post('/api/complaints', authRequired, async (req, res) => {
            const { title, description, attachments } = req.body;
            if (!title || !description) {
                return res.status(400).json({ error: 'Title dan description wajib diisi' });
            }
            try {
                const result = await complaintsCollection.insertOne({
                    userId: req.user.id,
                    title,
                    description,
                    attachments,
                    status: 'open',
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
                res.json({ success: true, id: result.insertedId });
            } catch (err) {
                console.error('❌  Error membuat pengaduan:', err);
                res.status(500).json({ error: 'Gagal membuat pengaduan' });
            }
        });

        // 8) Endpoint untuk mengambil semua pengaduan
        app.get('/api/complaints', async (req, res) => {
            try {
                const complaints = await complaintsCollection.find({}).toArray();
                res.json({ count: complaints.length, data: complaints });
            } catch (err) {
                console.error('❌  Error mengambil data complaints:', err);
                res.status(500).json({ error: 'Gagal mengambil data complaints' });
            }
        });

        // 9) Endpoint untuk mengambil pengaduan milik user
        app.get('/api/complaints/my', authRequired, async (req, res) => {
            const userId = req.user.id;
            try {
                const complaints = await complaintsCollection.find({ userId }).toArray();
                res.json({ count: complaints.length, data: complaints });
            } catch (err) {
                console.error('❌  Error mengambil data complaints milik user:', err);
                res.status(500).json({ error: 'Gagal mengambil data complaints milik user' });
            }
        });

        // 10) Endpoint untuk mengambil detail pengaduan
        app.get('/api/complaints/:id', async (req, res) => {
            const { id } = req.params;
            try {
                const complaint = await complaintsCollection.findOne({ _id: new ObjectId(id) });
                if (!complaint) {
                    return res.status(404).json({ error: 'Pengaduan tidak ditemukan' });
                }
                res.json(complaint);
            } catch (err) {
                console.error('❌  Error mengambil data complaint:', err);
                res.status(500).json({ error: 'Gagal mengambil data complaint' });
            }
        });

        // 11) Endpoint untuk mengubah status pengaduan
        app.patch('/api/complaints/:id/status', async (req, res) => {
            const { id } = req.params;
            const { status } = req.body;
            if (!status) {
                return res.status(400).json({ error: 'Parameter "status" wajib diisi' });
            }
            try {
                const result = await complaintsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status, updatedAt: new Date() } }
                );
                if (result.modifiedCount === 0) {
                    return res.status(404).json({ error: 'Pengaduan tidak ditemukan' });
                }
                res.json({ success: true });
            } catch (err) {
                console.error('❌  Error mengubah status complaint:', err);
                res.status(500).json({ error: 'Gagal mengubah status complaint' });
            }
        });

        // 12) Endpoint untuk menghapus pengaduan
        app.delete('/api/complaints/:id', async (req, res) => {
            const { id } = req.params;
            try {
                const result = await complaintsCollection.deleteOne({ _id: new ObjectId(id) });
                if (result.deletedCount === 0) {
                    return res.status(404).json({ error: 'Pengaduan tidak ditemukan' });
                }
                res.json({ success: true });
            } catch (err) {
                console.error('❌  Error menghapus complaint:', err);
                res.status(500).json({ error: 'Gagal menghapus complaint' });
            }
        });

        // --- Middleware ----------------------------------------------------------------
        function authRequired(req, res, next) {
            const token = req.headers.authorization?.split(' ')[1];
            if (!token) return res.status(401).json({ error: 'Token missing' });
            try {
                req.user = jwt.verify(token, SECRET);
                next();
            } catch { return res.status(401).json({ error: 'Invalid token' }); }
        }

        // --- Register ------------------------------------------------------------------
        app.post('/api/register', async (req, res) => {
            const schema = Joi.object({
                name: Joi.string().min(2).required(),
                email: Joi.string().email().required(),
                password: Joi.string().min(6).required()
            });

            const { error, value: validatedData } = schema.validate(req.body, { abortEarly: false });
            if (error) return res.status(400).json({ error: error.message });

            if (!validatedData) return res.status(400).json({ error: 'Data tidak valid' });

            const { name, email, password } = validatedData;
            const exists = await usersCol.findOne({ email });
            if (exists) return res.status(409).json({ error: 'Email sudah terdaftar' });

            const passwordHash = await bcrypt.hash(password, 10);
            const result = await usersCol.insertOne({ name, email, passwordHash, role: 'user', createdAt: new Date() });
            res.json({ success: true, id: result.insertedId });
        });

        // Tambahkan endpoint LOGIN setelah register
        app.post('/api/login', async (req, res) => {
            const schema = Joi.object({
                email: Joi.string().email().required(),
                password: Joi.string().required()
            });
            const { error, value: validatedData } = schema.validate(req.body, { abortEarly: false });
            if (error) return res.status(400).json({ error: error.message });

            const { email, password } = validatedData;
            const user = await usersCol.findOne({ email });
            if (!user) return res.status(401).json({ error: 'Email atau password salah' });

            const match = await bcrypt.compare(password, user.passwordHash);
            if (!match) return res.status(401).json({ error: 'Email atau password salah' });

            const token = jwt.sign({ id: user._id.toString(), email: user.email, role: user.role }, SECRET, { expiresIn: '12h' });
            res.json({ token });
        });

        // 13) Mulai server
        app.listen(PORT, () => {
            console.log(`🚀  Server berjalan di http://localhost:${PORT}`);
            console.log(`🎬  Endpoint list film   : http://localhost:${PORT}/api/movies`);
            console.log(`🔍  Endpoint cari film   : http://localhost:${PORT}/api/movies/search?title=Batman`);
        });

        // 14) Penanganan graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\n🛑  Menutup server...');
            await client.close();
            console.log('✅  Koneksi MongoDB ditutup');
            process.exit(0);
        });
    } catch (err) {
        console.error('❌  Gagal memulai server:', err);
        process.exit(1);
    }
}

startServer();
