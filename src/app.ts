import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import dtfRoutes from './routes/dtfRoutes';
import { EventIndexer } from './services/eventIndexer';

dotenv.config();

const app = express();
const port = process.env.PORT || 8080; // Changed to 8080 to match Railway

// Middleware
app.use(cors({
  origin: [
    'https://ego-git-main-james-o-connors-projects.vercel.app',    // Vercel
    'http://localhost:5173',              // Local development
    'http://localhost:3000'               // Alternative local port
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(helmet());
app.use(express.json());

// Add a health check endpoint
app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Routes
app.use('/api/v1', dtfRoutes);

// Initialize event indexer
const eventIndexer = new EventIndexer();
eventIndexer.startIndexing().catch(console.error);

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

export default app;