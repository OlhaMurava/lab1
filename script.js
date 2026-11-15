require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const validator = require('validator');
const path = require('path');

const app = express();

// Дозволяємо завантаження React/Babel/Unsplash скриптів у хмарному середовищі
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10kb' }));
app.use(cors());

// Роздача клієнтської частини (public/index.html)
app.use(express.static(path.join(__dirname, 'public')));

// Отримання конфігурації зі змінних середовища (ENV)
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('❌ ПОМИЛКА: Змінна середовища MONGO_URI не задана!');
    process.exit(1);
}

// Моделі MongoDB
const productSchema = new mongoose.Schema({
    name: { type: String, required: true },
    category: { type: String, required: true },
    price: { type: Number, required: true },
    inStock: { type: Boolean, default: true },
    image: { type: String }
});
const Product = mongoose.model('Product', productSchema);

const orderSchema = new mongoose.Schema({
    customerName: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    paymentMethod: { type: String, enum: ['card', 'apple_pay', 'cash'], default: 'apple_pay' },
    comment: { type: String, default: '' },
    items: [{ name: String, price: Number, quantity: Number }],
    totalAmount: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Успішно підключено до MongoDB Atlas через ENV'))
    .catch(err => console.error('Помилка підключення до БД:', err));

function sanitizeInput(str) {
    if (typeof str !== 'string') return '';
    return validator.escape(str.trim());
}

// Ендпоінт моніторингу продуктивності сервісу (Health & Metrics)
app.get('/api/health', (req, res) => {
    const memory = process.memoryUsage();
    const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    res.status(200).json({
        status: 'OK',
        environment: process.env.NODE_ENV || 'development',
        uptimeSeconds: Math.round(process.uptime()),
        databaseStatus: dbStates[mongoose.connection.readyState] || 'unknown',
        memoryUsageMB: {
            rss: (memory.rss / 1024 / 1024).toFixed(2),
            heapTotal: (memory.heapTotal / 1024 / 1024).toFixed(2),
            heapUsed: (memory.heapUsed / 1024 / 1024).toFixed(2)
        },
        timestamp: new Date().toISOString()
    });
});

// REST API: Отримання товарів
app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find();
        res.status(200).json(products);
    } catch (err) {
        res.status(500).json({ error: 'Помилка отримання товарів' });
    }
});

// REST API: Оформлення замовлення
app.post('/api/orders', async (req, res) => {
    try {
        const { customerName, email, phone, paymentMethod, comment, items } = req.body;
        const errors = [];

        if (!customerName || customerName.trim().length < 2) {
            errors.push("Ім'я повинно містити щонайменше 2 символи.");
        }
        if (!email || !validator.isEmail(email)) {
            errors.push('Вкажіть коректну адресу електронної пошти (Email).');
        }
        if (!phone || !/^\+?[0-9]{10,13}$/.test(phone.replace(/[\s()-]/g, ''))) {
            errors.push('Вкажіть коректний номер телефону (10–13 цифр).');
        }
        if (!Array.isArray(items) || items.length === 0) {
            errors.push('Кошик порожній. Додайте хоча б один товар.');
        }

        if (errors.length > 0) {
            return res.status(400).json({ error: 'Помилка валідації даних', details: errors });
        }

        const newOrder = new Order({
            customerName: sanitizeInput(customerName),
            email: validator.normalizeEmail(email),
            phone: sanitizeInput(phone),
            paymentMethod: ['card', 'apple_pay', 'cash'].includes(paymentMethod) ? paymentMethod : 'apple_pay',
            comment: sanitizeInput(comment || ''),
            items,
            totalAmount: items.reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity || 1)), 0)
        });

        const savedOrder = await newOrder.save();
        res.status(201).json({
            message: 'Замовлення успішно оформлено та збережено в базі даних!',
            orderId: savedOrder._id,
            customerName: savedOrder.customerName,
            totalAmount: savedOrder.totalAmount
        });
    } catch (err) {
        res.status(500).json({ error: 'Внутрішня помилка сервера' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер запущено на порту ${PORT} (${process.env.NODE_ENV || 'dev'})`);
});