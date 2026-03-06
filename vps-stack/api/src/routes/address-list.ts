import { Router, Response } from 'express';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { mikrotikRequest, getDeviceConfig } from '../lib/mikrotik';
import { pool } from '../lib/db';

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

// Toggle suspension (add/remove from address list)
addressListRouter.post('/toggle-suspension', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotik_id, address, list, action, comment } = req.body;
    if (!mikrotik_id || !address || !list) {
      return res.status(400).json({ error: 'mikrotik_id, address y list requeridos' });
    }

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotik_id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotik_id);

    if (action === 'remove') {
      // Find and remove
      const entries = await mikrotikRequest(config, '/rest/ip/firewall/address-list') as any[];
      const entry = entries.find((e: any) => e.address === address && e.list === list);
      if (entry) {
        await mikrotikRequest(config, `/rest/ip/firewall/address-list/${entry['.id']}`, 'DELETE');
      }
    } else {
      // Add
      await mikrotikRequest(config, '/rest/ip/firewall/address-list/add', 'POST', {
        list,
        address,
        comment: comment || 'Suspendido por OmniSync',
      });
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
