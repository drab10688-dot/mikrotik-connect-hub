import { Router, Response } from 'express';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { pool } from '../lib/db';

export const portalAdsRouter = Router();

// ─── Public: Get active ads for default/first device (no auth needed) ────
portalAdsRouter.get('/public/default', async (req: any, res: Response) => {
  try {
    const position = req.query.position as string;
    // Get first mikrotik device
    const { rows: devices } = await pool.query('SELECT id FROM mikrotik_devices LIMIT 1');
    if (!devices.length) return res.json({ success: true, data: [] });
    const mikrotikId = devices[0].id;

    let query = `
      SELECT id, title, description, image_url, link_url, advertiser_name, position, priority
      FROM portal_ads
      WHERE mikrotik_id = $1
        AND is_active = true
        AND (start_date IS NULL OR start_date <= CURRENT_DATE)
        AND (end_date IS NULL OR end_date >= CURRENT_DATE)
    `;
    const params: any[] = [mikrotikId];
    if (position) {
      query += ` AND position = $2`;
      params.push(position);
    }
    query += ` ORDER BY priority DESC, created_at DESC`;
    const { rows } = await pool.query(query, params);
    res.json({ success: true, data: rows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Public: Get active ads for a mikrotik (no auth needed) ────
portalAdsRouter.get('/public/:mikrotikId', async (req: any, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const position = req.query.position as string;

    let query = `
      SELECT id, title, description, image_url, link_url, advertiser_name, position, priority
      FROM portal_ads
      WHERE mikrotik_id = $1
        AND is_active = true
        AND (start_date IS NULL OR start_date <= CURRENT_DATE)
        AND (end_date IS NULL OR end_date >= CURRENT_DATE)
    `;
    const params: any[] = [mikrotikId];

    if (position) {
      query += ` AND position = $2`;
      params.push(position);
    }

    query += ` ORDER BY priority DESC, created_at DESC`;

    const { rows } = await pool.query(query, params);
    res.json({ success: true, data: rows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Public: Track impression ────
portalAdsRouter.post('/public/:adId/impression', async (req: any, res: Response) => {
  try {
    const { adId } = req.params;
    await pool.query('UPDATE portal_ads SET impressions = impressions + 1 WHERE id = $1', [adId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Public: Track click ────
portalAdsRouter.post('/public/:adId/click', async (req: any, res: Response) => {
  try {
    const { adId } = req.params;
    await pool.query('UPDATE portal_ads SET clicks = clicks + 1 WHERE id = $1', [adId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Protected: List all ads for a device ────
portalAdsRouter.get('/:mikrotikId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      `SELECT * FROM portal_ads WHERE mikrotik_id = $1 ORDER BY priority DESC, created_at DESC`,
      [mikrotikId]
    );
    res.json({ success: true, data: rows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Create ad ────
portalAdsRouter.post('/:mikrotikId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const {
      title, description, image_url, link_url,
      advertiser_name, advertiser_phone, advertiser_email,
      position, is_active, priority, start_date, end_date, monthly_fee
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO portal_ads (
        mikrotik_id, created_by, title, description, image_url, link_url,
        advertiser_name, advertiser_phone, advertiser_email,
        position, is_active, priority, start_date, end_date, monthly_fee
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        mikrotikId, req.userId, title, description || null, image_url || null, link_url || null,
        advertiser_name, advertiser_phone || null, advertiser_email || null,
        position || 'banner', is_active !== false, priority || 0,
        start_date || null, end_date || null, monthly_fee || 0
      ]
    );

    res.status(201).json({ success: true, data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Update ad ────
portalAdsRouter.put('/:mikrotikId/:adId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, adId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    const allowedFields = [
      'title', 'description', 'image_url', 'link_url',
      'advertiser_name', 'advertiser_phone', 'advertiser_email',
      'position', 'is_active', 'priority', 'start_date', 'end_date', 'monthly_fee'
    ];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        fields.push(`${field} = $${idx}`);
        values.push(req.body[field]);
        idx++;
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    values.push(adId);
    const { rows } = await pool.query(
      `UPDATE portal_ads SET ${fields.join(', ')}, updated_at = now() WHERE id = $${idx} RETURNING *`,
      values
    );

    res.json({ success: true, data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Delete ad ────
portalAdsRouter.delete('/:mikrotikId/:adId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, adId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    await pool.query('DELETE FROM portal_ads WHERE id = $1 AND mikrotik_id = $2', [adId, mikrotikId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Stats for ads ────
portalAdsRouter.get('/:mikrotikId/stats/summary', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      `SELECT
        COUNT(*) as total_ads,
        COUNT(*) FILTER (WHERE is_active) as active_ads,
        COALESCE(SUM(impressions), 0) as total_impressions,
        COALESCE(SUM(clicks), 0) as total_clicks,
        COALESCE(SUM(monthly_fee) FILTER (WHERE is_active), 0) as monthly_revenue,
        CASE WHEN COALESCE(SUM(impressions), 0) > 0
          THEN ROUND(COALESCE(SUM(clicks)::numeric, 0) / SUM(impressions) * 100, 2)
          ELSE 0 END as ctr
      FROM portal_ads WHERE mikrotik_id = $1`,
      [mikrotikId]
    );
    res.json({ success: true, data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
