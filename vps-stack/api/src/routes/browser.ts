import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { browserStatus, openInBrowser } from '../lib/remote-browser';

export const browserRouter = Router();

/** Estado del Firefox remoto. */
browserRouter.get('/status', async (_req: AuthRequest, res: Response) => {
  const state = await browserStatus();
  res.json({ success: true, data: state });
});

/** Abre una URL directamente en el Firefox remoto. */
browserRouter.post('/open', async (req: AuthRequest, res: Response) => {
  const url = String(req.body?.url || '').trim();
  if (!url) return res.status(400).json({ success: false, error: 'URL requerida' });

  const result = await openInBrowser(url);
  if (!result.ok) return res.status(503).json({ success: false, error: result.error });

  res.json({ success: true, data: { url } });
});
