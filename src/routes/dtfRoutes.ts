// src/routes/dtfRoutes.ts
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'node:events';

const router = express.Router();
const prisma = new PrismaClient();


interface DTFUpdateEvent {
  type: 'DTFSettled';
  dtfID: number;
}

const dtfEventEmitter = new EventEmitter();

router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event: DTFUpdateEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  dtfEventEmitter.on('dtfUpdate', sendEvent);

  req.on('close', () => {
    dtfEventEmitter.off('dtfUpdate', sendEvent);
  });
});

// Get all DTFs
router.get('/dtfs', async (req, res) => {
  try {
    const dtfs = await prisma.dTF.findMany({
      include: {
        tokens: true,
        positions: true,
        events: true
      }
    });
    res.json(dtfs);
  } catch (error) {
    console.error('Error fetching DTFs:', error);
    res.status(500).json({ error: 'Failed to fetch DTFs' });
  }
});

router.get('/dtfs/:dtfId/fees', async (req, res) => {
  try {
    const { dtfId } = req.params;
    
    // Get all positions for this DTF
    const positions = await prisma.position.findMany({
      where: {
        dtfId: Number(dtfId)
      }
    });

    // Sum up total user spend (which includes fees)
    const totalVolume = positions.reduce((sum, position) => {
      return sum + ((position.entryPrice * position.shareAmount) / 1e6);
    }, 0);

    // Calculate creator's 1.2% fee
    const creatorFees = totalVolume * 0.012;

    res.json({
      totalVolume,
      creatorFees
    });

  } catch (error) {
    console.error('Error calculating fees:', error);
    res.status(500).json({ error: 'Failed to calculate fees' });
  }
});

// Get user positions
router.get('/positions/:userAddress', async (req, res) => {
  try {
    const { userAddress } = req.params;
    const positions = await prisma.position.findMany({
      where: {
        userAddress: userAddress
      },
      include: {
        dtf: true
      }
    });
    res.json(positions);
  } catch (error) {
    console.error('Error fetching positions:', error);
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

// Add this new endpoint for detailed position information
router.get('/positions/:userAddress/details', async (req, res) => {
  try {
    const { userAddress } = req.params;
    const positions = await prisma.position.findMany({
      where: {
        userAddress: userAddress
      },
      include: {
        dtf: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const formattedPositions = positions.map(position => ({
      dtfId: position.dtfId,
      dtfName: position.dtf.name,
      positionType: position.isYesPosition ? 'YES' : 'NO',
      shares: position.shareAmount,
      entryPrice: `$${(position.entryPrice / 1e6).toFixed(6)}`,
      totalCost: `$${((position.entryPrice * position.shareAmount) / 1e6).toFixed(6)}`,
      status: position.dtf.isSettled ? 'Settled' : 'Active',
      claimed: position.claimed,
      createdAt: position.createdAt
    }));

    res.json(formattedPositions);
  } catch (error) {
    console.error('Error fetching position details:', error);
    res.status(500).json({ error: 'Failed to fetch position details' });
  }
});

interface GroupedPosition {
  dtfId: number;
  dtfName: string;
  isYesPosition: boolean;
  totalShares: number;
  totalCost: number;
  dtf: any; // Or define proper DTF type from your Prisma schema
  claimed: boolean;
}

interface PositionGroups {
  [key: string]: GroupedPosition;
}

// Then get DTF data and format trades
router.get('/trades/:userAddress', async (req, res) => {
  try {
    // Add no-cache headers
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');

    const { userAddress } = req.params;

    // Add logging to debug prisma query
    console.log('Fetching trades for user:', userAddress);

    const positions = await prisma.position.findMany({
      where: {
        userAddress: userAddress
      },
      include: {
        dtf: true
      },
      orderBy: [
        { dtfId: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    console.log('Found positions:', positions.length); // Debug log

    const formattedTrades = await Promise.all(
      Object.values(positions.reduce((acc: PositionGroups, position) => {
        const key = `${position.dtfId}-${position.isYesPosition}`;
        if (!acc[key]) {
          acc[key] = {
            dtfId: position.dtfId,
            dtfName: position.dtf.name,
            isYesPosition: position.isYesPosition,
            totalShares: 0,
            totalCost: 0,
            dtf: position.dtf,
            claimed: position.claimed
          };
        }
        acc[key].totalShares += position.shareAmount;
        acc[key].totalCost += (position.entryPrice * position.shareAmount) / 1e6;
        return acc;
      }, {})).map((groupedPosition: GroupedPosition) => {
        const averageEntryPrice = groupedPosition.totalCost / groupedPosition.totalShares;

        let roi;
        if (!groupedPosition.dtf.isSettled) {
          roi = groupedPosition.totalShares - groupedPosition.totalCost;
        } else {
          if ((groupedPosition.isYesPosition && groupedPosition.dtf.yesWon) ||
            (!groupedPosition.isYesPosition && !groupedPosition.dtf.yesWon)) {
            roi = groupedPosition.totalShares - groupedPosition.totalCost;
          } else {
            roi = -groupedPosition.totalCost;
          }
        }

        const expiryTime = new Date(groupedPosition.dtf.expiryTime).getTime();
        const currentTime = Date.now();

       /* console.log('Status Check:', {
          dtfId: groupedPosition.dtfId,
          expiryTime,
          currentTime,
          expiryDate: new Date(groupedPosition.dtf.expiryTime).toISOString(),
          currentDate: new Date(currentTime).toISOString(),
          isSettled: groupedPosition.dtf.isSettled
        }); */

        return {
          dtfId: groupedPosition.dtfId,
          dtfName: groupedPosition.dtfName,
          position: groupedPosition.isYesPosition ? 'YES' : 'NO',
          shares: groupedPosition.totalShares,
          averageEntryPrice: `$${averageEntryPrice.toFixed(6)}`,
          totalCost: `$${groupedPosition.totalCost.toFixed(2)}`,
          roi: typeof roi === 'number' ?
            `${roi > 0 ? '+' : ''}$${roi.toFixed(2)}` :
            roi,
          status: groupedPosition.dtf.isSettled ? 'Settled' : 'Active',
          claimed: groupedPosition.claimed,
          yesWon: groupedPosition.dtf.yesWon,
          canClaim: groupedPosition.dtf.isSettled && !groupedPosition.claimed,
          dtf: groupedPosition.dtf
        };
      })
    );

    res.json(formattedTrades);
  } catch (error) {
    console.error('Error fetching trades:', error);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

export const emitDTFUpdate = (data: DTFUpdateEvent) => {
  dtfEventEmitter.emit('dtfUpdate', data);
};

// Add this new endpoint before export default router
router.post('/trades/:userAddress/claim/:dtfId', async (req, res) => {
  try {
    const { userAddress, dtfId } = req.params;

    // Update all positions for this user and DTF to claimed
    await prisma.position.updateMany({
      where: {
        userAddress: userAddress,
        dtfId: Number(dtfId),
      },
      data: {
        claimed: true,
        claimedAt: new Date()
      }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating claim status:', error);
    res.status(500).json({ error: 'Failed to update claim status' });
  }
});

export default router;