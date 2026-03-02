import { Router, Response } from 'express';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { mikrotikRequest, getDeviceConfig } from '../lib/mikrotik';
import { pool } from '../server';

export const addressListRouter = Router();

// List address lists
addressListRouter.get('/:mikrotikId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);
    const listName = req.query.list as string;

    const data = await mikrotikRequest(config, '/rest/ip/firewall/address-list');

    // Filter by list name if provided
    const filtered = listName
      ? (data as any[]).filter((entry: any) => entry.list === listName)
      : data;

    res.json({ success: true, data: filtered });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add to address list
addressListRouter.post('/:mikrotikId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { list, address, comment, timeout } = req.body;
    const config = await getDeviceConfig(pool, mikrotikId);

    const body: Record<string, string> = { list, address };
    if (comment) body.comment = comment;
    if (timeout) body.timeout = timeout;

    const data = await mikrotikRequest(config, '/rest/ip/firewall/address-list/add', 'POST', body);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remove from address list
addressListRouter.delete('/:mikrotikId/:entryId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, entryId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);
    await mikrotikRequest(config, `/rest/ip/firewall/address-list/${entryId}`, 'DELETE');
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
