const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();

const ENGINE_URL = process.env.ENGINE_URL || 'http://adminax-core:8080';

app.use(express.static('public'));
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views/index.html'));
});

app.post('/api/chat', async (req, res) => {
    try {
        const response = await axios.post(`${ENGINE_URL}/api/v1/chat`, req.body);
        res.json(response.data);
    } catch (error) {
        console.error('Engine Error:', error.message);
        res.status(500).json({ error: 'AI 엔진 연결 실패' });
    }
});

app.listen(8080, () => console.log('Chat UI Server on 8080'));
