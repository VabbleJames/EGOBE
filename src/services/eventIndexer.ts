import { ethers } from 'ethers';
import { PrismaClient } from '@prisma/client';
import DTFMarketABI from '../abis/DTFMarket.json';
import { Prisma } from '@prisma/client';

const prisma = new PrismaClient();

export class EventIndexer {
    private provider: ethers.JsonRpcProvider;
    private contract: ethers.Contract;

    constructor() {
        console.log('Initializing EventIndexer with RPC URL:', process.env.RPC_URL);
        this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        this.contract = new ethers.Contract(
            process.env.CONTRACT_ADDRESS!,
            DTFMarketABI,
            this.provider
        );
    }

    async startIndexing() {
        console.log('Starting event indexing...');
        //Clean dups
        await this.cleanupDuplicatePositions();

        // Then, fetch historical events
        await this.indexHistoricalEvents();

        // Then start listening for new events
        this.listenToEvents();
    }

    private async indexHistoricalEvents(): Promise<void> {
        try {
            const currentBlock = await this.provider.getBlockNumber();
            const fromBlock = Math.max(0, currentBlock - 20000);
    
            console.log(`Fetching historical events from block ${fromBlock} to ${currentBlock}`);
    
            // Fetch all events first
            const dtfCreatedEvents = await this.contract.queryFilter(this.contract.filters.DTFCreated(), fromBlock);
            const dtfSettledEvents = await this.contract.queryFilter(this.contract.filters.DTFSettled(), fromBlock);
            const tokensWithdrawnEvents = await this.contract.queryFilter(this.contract.filters.TokensWithdrawn(), fromBlock);
    
            // Sort all events by block number and transaction index
            const allEvents = [
                ...dtfCreatedEvents.map(e => ({...e, type: 'DTFCreated'})),
                ...dtfSettledEvents.map(e => ({...e, type: 'DTFSettled'})),
                ...tokensWithdrawnEvents.map(e => ({...e, type: 'TokensWithdrawn'}))
            ].sort((a, b) => {
                if (a.blockNumber !== b.blockNumber) {
                    return a.blockNumber - b.blockNumber;
                }
                return a.transactionIndex - b.transactionIndex;  // Using transactionIndex instead of logIndex
            });
    
            // Process events in order
            for (const event of allEvents) {
                switch (event.type) {
                    case 'DTFCreated':
                        await this.handleDTFCreated(event);
                        break;
                    case 'DTFSettled':
                        await this.handleDTFSettled(event);
                        break;
                    case 'TokensWithdrawn':
                        await this.handleTokensWithdrawn(event);
                        break;
                }
            }
        } catch (error) {
            console.error('Error indexing historical events:', error);
        }
    }

    private async handleDTFCreated(event: any) {
        try {
            const [dtfId, creator, targetValuation, isTargetHigher, yesToken, noToken] = event.args;
    
            // Create or find the user
            await prisma.user.upsert({
                where: { address: creator },
                create: {
                    address: creator,
                    totalVolume: 0
                },
                update: {} // Don't update if exists
            });
    
            // Then create the DTF
            await prisma.dTF.upsert({
                where: { id: Number(dtfId) },
                create: {
                    id: Number(dtfId),
                    creatorAddress: creator,
                    name: `DTF ${dtfId.toString()}`,
                    expiryTime: new Date(),
                    targetValuation: Number(ethers.formatUnits(targetValuation, 18)),
                    isTargetHigher,
                    yesTokenAddress: yesToken,
                    noTokenAddress: noToken,
                    yesPool: 0,
                    noPool: 0,
                    distributionPool: 0
                },
                update: {}
            });
    
            await prisma.event.create({
                data: {
                    dtfId: Number(dtfId),
                    eventType: 'DTFCreated',
                    transactionHash: event.transactionHash,
                    blockNumber: Number(event.blockNumber),
                    data: {  // Only change is here - properly formatting BigInt values
                        dtfId: Number(dtfId.toString()),
                        creator: creator,
                        targetValuation: Number(ethers.formatUnits(targetValuation, 18)),
                        isTargetHigher: Boolean(isTargetHigher),
                        yesToken: yesToken,
                        noToken: noToken
                    }
                }
            });
    
            console.log(`Indexed DTF #${dtfId} created by ${creator}`);
        } catch (error) {
            console.error('Error processing DTFCreated event:', error);
        }
    }

    private async handleSharesPurchased(event: any) {
        try {
            const eventData = event.log || event;  // Get this first for proper transaction hash access
            const transactionHash = eventData.transactionHash;
    
            // First check if this event was already processed
            const processedEvent = await prisma.processedEvent.findFirst({  // Changed from findUnique
                where: {
                    eventType: 'SharesPurchased',
                    transactionHash: transactionHash
                }
            });
    
            if (processedEvent) {
                console.log(`Event ${transactionHash} already processed, skipping`);
                return;
            }
    
            // Rest of your existing code remains exactly the same until the end of the try block
            const args = event.args || eventData.args;
            const blockNumber = eventData.blockNumber;
        
            if (!args || !transactionHash || !blockNumber) {
                console.error('Invalid event data structure:', event);
                return;
            }
        
            const [dtfId, isYesToken, amount] = args;
            
            // Get transaction with proper error handling
            const tx = await this.provider.getTransaction(transactionHash).catch(error => {
                console.error('Error fetching transaction:', error);
                return null;
            });
        
            if (!tx || !tx.from) {
                console.error('Could not fetch transaction or missing from address:', transactionHash);
                return;
            }
        
            // Log the event processing
            console.log('Processing SharesPurchased event:', {
                dtfId: dtfId.toString(),
                isYesToken,
                amount: amount.toString(),
                transactionHash,
                from: tx.from
            });
        
            // Check if this transaction has already been processed
            const existingPosition = await prisma.position.findFirst({
                where: {
                    dtfId: Number(dtfId.toString()),
                    userAddress: tx.from,
                    isYesPosition: isYesToken,
                    transactionHash: transactionHash
                }
            });
        
            if (existingPosition) {
                console.log(`Position already exists for DTF ${dtfId} and user ${tx.from}`);
                return;
            }
        
            // Get the share prices from the previous block
            const sharePrices = await this.contract.getSharePrices(dtfId, {
                blockTag: blockNumber - 1
            });
                
            const entryPrice = isYesToken ? 
                Number(sharePrices[0]) : 
                Number(sharePrices[1]);
        
            console.log('Price data from previous block:', {
                blockNumber: blockNumber - 1,
                yesPrice: sharePrices[0].toString(),
                noPrice: sharePrices[1].toString(),
                selectedPrice: entryPrice,
                isYesToken
            });
        
            const shareAmount = Number(ethers.formatUnits(amount, 18));
            const totalCost = shareAmount * (entryPrice / 1e6);
        
            console.log('Price calculations:', {
                shareAmount,
                entryPrice: entryPrice / 1e6,
                totalCost
            });
        
            // Create or find the user first
            await prisma.user.upsert({
                where: { address: tx.from },
                create: {
                    address: tx.from,
                    totalVolume: 0
                },
                update: {}
            });
    
            // Find any existing position for this DTF/user/position type
            const existingUserPosition = await prisma.position.findFirst({
                where: {
                    dtfId: Number(dtfId.toString()),
                    userAddress: tx.from,
                    isYesPosition: isYesToken
                }
            });
    
            let position;
            if (existingUserPosition) {
                // Update existing position
                position = await prisma.position.update({
                    where: {
                        id: existingUserPosition.id
                    },
                    data: {
                        shareAmount: existingUserPosition.shareAmount + shareAmount
                    }
                });
            } else {
                // Create new position
                position = await prisma.position.create({
                    data: {
                        userAddress: tx.from,
                        dtfId: Number(dtfId.toString()),
                        isYesPosition: isYesToken,
                        shareAmount: shareAmount,
                        entryPrice: entryPrice,
                        claimed: false,
                        transactionHash: transactionHash
                    }
                });
            }
        
            console.log('Created/Updated position:', {
                ...position,
                formattedEntryPrice: position.entryPrice / 1e6,
                formattedTotalCost: (position.entryPrice * position.shareAmount) / 1e6
            });
    
            // Create processed event record
            await prisma.processedEvent.create({
                data: {
                    eventType: 'SharesPurchased',
                    transactionHash: transactionHash,
                    blockNumber: blockNumber
                }
            });
    
        } catch (error) {
            console.error('Error processing SharesPurchased event:', error);
            if (error instanceof Error) {
                console.error('Error details:', {
                    message: error.message,
                    stack: error.stack
                });
            }
        }
    }

    private async handleDTFSettled(event: any) {
        console.log('DTFSettled event received:', {
            dtfId: event.args[0].toString(),
            yesWon: event.args[1],
            transactionHash: event.transactionHash,
            blockNumber: event.blockNumber
        });
    
        try {
            const [dtfId, yesWon] = event.args;
            const dtfIdNumber = Number(dtfId.toString());
    
            const existingDTF = await prisma.dTF.findUnique({
                where: { id: dtfIdNumber }
            });
    
            if (!existingDTF) {
                console.log(`DTF ${dtfIdNumber} not found, skipping update`);
                return;
            }
    
            console.log('Attempting DTF settlement transaction:', {
                dtfId: dtfIdNumber,
                yesWon: Boolean(yesWon),
                currentDTFState: existingDTF
            });
    
            await prisma.$transaction([
                prisma.dTF.update({
                    where: { id: dtfIdNumber },
                    data: { 
                        isSettled: true,
                        yesWon: Boolean(yesWon)
                    }
                }),
                prisma.event.create({
                    data: {
                        dtfId: dtfIdNumber,
                        eventType: 'DTFSettled',
                        transactionHash: event.transactionHash || 'unknown',
                        blockNumber: Number(event.blockNumber || 0),
                        data: {
                            dtfId: dtfIdNumber,
                            yesWon: Boolean(yesWon)
                        }
                    }
                })
            ]);
    
            console.log('Successfully settled DTF:', {
                dtfId: dtfIdNumber,
                yesWon: Boolean(yesWon)
            });
    
        } catch (error) {
            console.error('Error processing DTFSettled event:', {
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
                errorName: error instanceof Error ? error.name : 'Unknown error type',
                stack: error instanceof Error ? error.stack : 'No stack trace'
            });
            throw error;
        }
    }

    private async handleTokensWithdrawn(event: any) {
        try {
            const [dtfId] = event.args;
            const tx = await this.provider.getTransaction(event.transactionHash);
            
            if (!tx || !tx.from) return;
    
            // Convert dtfId to Number and verify DTF exists
            const dtfIdNumber = Number(dtfId.toString());
            
            // Check if DTF exists first
            const dtf = await prisma.dTF.findUnique({
                where: {
                    id: dtfIdNumber
                }
            });
    
            if (!dtf) {
                console.log(`DTF ${dtfIdNumber} not found, cannot process TokensWithdrawn event`);
                return;
            }
    
            // Update the position record to mark it as claimed
            await prisma.position.updateMany({
                where: {
                    dtfId: dtfIdNumber,
                    userAddress: tx.from,
                },
                data: {
                    claimed: true
                }
            });
    
            // Create event record with verified dtfId
            await prisma.event.create({
                data: {
                    dtfId: dtfIdNumber,
                    eventType: 'TokensWithdrawn',
                    transactionHash: event.transactionHash,
                    blockNumber: event.blockNumber,
                    data: {
                        dtfId: dtfIdNumber,
                        userAddress: tx.from,
                        timestamp: new Date().toISOString()
                    }
                }
            });
    
            console.log(`Indexed TokensWithdrawn for DTF #${dtfIdNumber} by user ${tx.from}`);
        } catch (error) {
            console.error('Error processing TokensWithdrawn event:', error);
            // More detailed error logging
            if (error instanceof Error) {
                console.error('Error details:', {
                    message: error.message,
                    stack: error.stack
                });
            }
        }
    }

    private async cleanupDuplicatePositions() {
        try {
            console.log('Starting duplicate position cleanup...');
            
            // Use type from Prisma schema
            const positions = await prisma.$queryRaw<Prisma.PositionGroupByOutputType[]>`
                SELECT "dtfId", "userAddress", "isYesPosition", COUNT(*) as count
                FROM "Position"
                GROUP BY "dtfId", "userAddress", "isYesPosition"
                HAVING COUNT(*) > 1
            `;
        
            console.log(`Found ${positions.length} groups with duplicates`);
        
            for (const group of positions) {
                const duplicates = await prisma.position.findMany({
                    where: {
                        dtfId: group.dtfId,
                        userAddress: group.userAddress,
                        isYesPosition: group.isYesPosition
                    },
                    orderBy: {
                        createdAt: 'asc'
                    }
                });
        
                if (duplicates.length > 1) {
                    const [keep, ...remove] = duplicates;
                    console.log(`Keeping position ${keep.id} and removing ${remove.length} duplicates for DTF ${group.dtfId}`);
                    
                    await prisma.position.deleteMany({
                        where: {
                            id: {
                                in: remove.map(p => p.id)
                            }
                        }
                    });
                }
            }
            console.log('Duplicate cleanup complete');
        } catch (error) {
            console.error('Error cleaning up duplicates:', error);
        }
    }
    
    private listenToEvents() {
        // Basic event listeners that were working before
        this.contract.on('DTFCreated', async (...args) => {
            const event = args[args.length - 1];
            await this.handleDTFCreated(event);
        });
    
        this.contract.on('SharesPurchased', async (...args) => {
            const event = args[args.length - 1];
            await this.handleSharesPurchased(event);
        });
    
        this.contract.on('DTFSettled', async (...args) => {
            const event = args[args.length - 1];
            
            console.log('Raw DTFSettled event:', event); // Debug log
    
            try {
                if (!event.transactionHash || !event.blockNumber) {
                    // Get the transaction hash from the event
                    const txHash = event.log?.transactionHash || event.transactionHash;
                    
                    if (!txHash) {
                        console.error('No transaction hash available in event');
                        return;
                    }
    
                    const receipt = await this.provider.waitForTransaction(txHash);
                    if (receipt) {
                        event.transactionHash = receipt.hash;
                        event.blockNumber = receipt.blockNumber;
                    } else {
                        console.error('Failed to get transaction receipt for DTF settlement');
                        return;
                    }
                }
                
                await this.handleDTFSettled(event);
            } catch (error) {
                console.error('Error in DTFSettled event listener:', error);
            }
        });
    
    
        this.contract.on('TokensWithdrawn', async (...args) => {
            const event = args[args.length - 1];
            await this.handleTokensWithdrawn(event);
        });
    }
    }