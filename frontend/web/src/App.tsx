import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface ClaimRecord {
  id: string;
  policyNumber: string;
  claimAmount: number;
  claimDate: string;
  provider: string;
  status: string;
  encryptedAmount: string;
  isVerified: boolean;
  decryptedValue?: number;
  timestamp: number;
  creator: string;
}

interface FraudStats {
  totalClaims: number;
  verifiedClaims: number;
  potentialFrauds: number;
  totalAmount: number;
  avgProcessingTime: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingClaim, setCreatingClaim] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newClaimData, setNewClaimData] = useState({ 
    policyNumber: "", 
    claimAmount: "", 
    provider: "", 
    claimDate: "" 
  });
  const [selectedClaim, setSelectedClaim] = useState<ClaimRecord | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadClaims();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadClaims = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const claimsList: ClaimRecord[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          claimsList.push({
            id: businessId,
            policyNumber: businessData.name,
            claimAmount: Number(businessData.publicValue1) || 0,
            claimDate: new Date(Number(businessData.timestamp) * 1000).toISOString().split('T')[0],
            provider: businessData.description,
            status: businessData.isVerified ? "Verified" : "Pending",
            encryptedAmount: businessId,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator
          });
        } catch (e) {
          console.error('Error loading claim data:', e);
        }
      }
      
      setClaims(claimsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load claims" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createClaim = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingClaim(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted claim record..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const claimAmount = parseInt(newClaimData.claimAmount) || 0;
      const businessId = `claim-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, claimAmount);
      
      const tx = await contract.createBusinessData(
        businessId,
        newClaimData.policyNumber,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        claimAmount,
        0,
        newClaimData.provider
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Claim record created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadClaims();
      setShowCreateModal(false);
      setNewClaimData({ policyNumber: "", claimAmount: "", provider: "", claimDate: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingClaim(false); 
    }
  };

  const decryptClaim = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadClaims();
      
      setTransactionStatus({ visible: true, status: "success", message: "Claim amount decrypted and verified!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadClaims();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: `Contract is ${isAvailable ? "available" : "unavailable"}` 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const getFraudStats = (): FraudStats => {
    const totalClaims = claims.length;
    const verifiedClaims = claims.filter(c => c.isVerified).length;
    const potentialFrauds = claims.filter(c => 
      c.isVerified && c.decryptedValue && c.decryptedValue > 10000
    ).length;
    const totalAmount = claims.reduce((sum, c) => sum + c.claimAmount, 0);
    const avgProcessingTime = claims.length > 0 ? 
      claims.reduce((sum, c) => sum + (Date.now()/1000 - c.timestamp), 0) / claims.length : 0;

    return {
      totalClaims,
      verifiedClaims,
      potentialFrauds,
      totalAmount,
      avgProcessingTime: avgProcessingTime / 3600
    };
  };

  const filteredClaims = claims.filter(claim => {
    const matchesSearch = claim.policyNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         claim.provider.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterStatus === "all" || claim.status.toLowerCase() === filterStatus.toLowerCase();
    return matchesSearch && matchesFilter;
  });

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🛡️ Private Insurance Fraud Detection</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🛡️</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to access the encrypted insurance fraud detection system.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet using the button above</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will automatically initialize</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start monitoring encrypted insurance claims</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Secure claim processing initializing</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading fraud detection system...</p>
    </div>
  );

  const stats = getFraudStats();

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🛡️ FraudDetect_Z</h1>
          <span>Privacy-Preserving Insurance Fraud Detection</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="status-btn">
            Check System
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Claim
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panels">
          <div className="stat-panel">
            <div className="stat-icon">📊</div>
            <div className="stat-content">
              <h3>Total Claims</h3>
              <div className="stat-value">{stats.totalClaims}</div>
            </div>
          </div>
          
          <div className="stat-panel">
            <div className="stat-icon">✅</div>
            <div className="stat-content">
              <h3>Verified</h3>
              <div className="stat-value">{stats.verifiedClaims}</div>
            </div>
          </div>
          
          <div className="stat-panel">
            <div className="stat-icon">⚠️</div>
            <div className="stat-content">
              <h3>Potential Fraud</h3>
              <div className="stat-value">{stats.potentialFrauds}</div>
            </div>
          </div>
          
          <div className="stat-panel">
            <div className="stat-icon">💰</div>
            <div className="stat-content">
              <h3>Total Amount</h3>
              <div className="stat-value">${stats.totalAmount.toLocaleString()}</div>
            </div>
          </div>
        </div>

        <div className="search-filters">
          <div className="search-box">
            <input
              type="text"
              placeholder="Search policies or providers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="filter-buttons">
            <button 
              className={filterStatus === "all" ? "active" : ""}
              onClick={() => setFilterStatus("all")}
            >
              All
            </button>
            <button 
              className={filterStatus === "pending" ? "active" : ""}
              onClick={() => setFilterStatus("pending")}
            >
              Pending
            </button>
            <button 
              className={filterStatus === "verified" ? "active" : ""}
              onClick={() => setFilterStatus("verified")}
            >
              Verified
            </button>
          </div>
        </div>

        <div className="claims-section">
          <div className="section-header">
            <h2>Insurance Claims</h2>
            <button onClick={loadClaims} className="refresh-btn" disabled={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "🔄 Refresh"}
            </button>
          </div>
          
          <div className="claims-list">
            {filteredClaims.length === 0 ? (
              <div className="no-claims">
                <p>No claims found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Create First Claim
                </button>
              </div>
            ) : (
              filteredClaims.map((claim, index) => (
                <div 
                  className={`claim-item ${claim.isVerified ? "verified" : "pending"}`}
                  key={index}
                  onClick={() => setSelectedClaim(claim)}
                >
                  <div className="claim-header">
                    <div className="claim-policy">{claim.policyNumber}</div>
                    <div className={`claim-status ${claim.status.toLowerCase()}`}>
                      {claim.status}
                    </div>
                  </div>
                  <div className="claim-details">
                    <span>Provider: {claim.provider}</span>
                    <span>Date: {claim.claimDate}</span>
                    <span>Amount: ${claim.claimAmount.toLocaleString()}</span>
                  </div>
                  <div className="claim-actions">
                    {claim.isVerified && claim.decryptedValue && (
                      <span className="decrypted-amount">
                        Decrypted: ${claim.decryptedValue.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateClaim 
          onSubmit={createClaim} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingClaim} 
          claimData={newClaimData} 
          setClaimData={setNewClaimData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedClaim && (
        <ClaimDetailModal 
          claim={selectedClaim} 
          onClose={() => setSelectedClaim(null)} 
          decryptClaim={() => decryptClaim(selectedClaim.id)}
          isDecrypting={fheIsDecrypting}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateClaim: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  claimData: any;
  setClaimData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, claimData, setClaimData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'claimAmount') {
      const intValue = value.replace(/[^\d]/g, '');
      setClaimData({ ...claimData, [name]: intValue });
    } else {
      setClaimData({ ...claimData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-claim-modal">
        <div className="modal-header">
          <h2>New Insurance Claim</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Claim amount will be encrypted with Zama FHE for privacy protection</p>
          </div>
          
          <div className="form-group">
            <label>Policy Number *</label>
            <input 
              type="text" 
              name="policyNumber" 
              value={claimData.policyNumber} 
              onChange={handleChange} 
              placeholder="Enter policy number..." 
            />
          </div>
          
          <div className="form-group">
            <label>Claim Amount (Integer only) *</label>
            <input 
              type="number" 
              name="claimAmount" 
              value={claimData.claimAmount} 
              onChange={handleChange} 
              placeholder="Enter claim amount..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Insurance Provider *</label>
            <input 
              type="text" 
              name="provider" 
              value={claimData.provider} 
              onChange={handleChange} 
              placeholder="Enter provider name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Claim Date *</label>
            <input 
              type="date" 
              name="claimDate" 
              value={claimData.claimDate} 
              onChange={handleChange} 
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !claimData.policyNumber || !claimData.claimAmount || !claimData.provider} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Claim"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ClaimDetailModal: React.FC<{
  claim: ClaimRecord;
  onClose: () => void;
  decryptClaim: () => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ claim, onClose, decryptClaim, isDecrypting }) => {
  const [localDecrypted, setLocalDecrypted] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (claim.isVerified) return;
    
    const decrypted = await decryptClaim();
    if (decrypted !== null) {
      setLocalDecrypted(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="claim-detail-modal">
        <div className="modal-header">
          <h2>Claim Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="claim-info">
            <div className="info-row">
              <span>Policy Number:</span>
              <strong>{claim.policyNumber}</strong>
            </div>
            <div className="info-row">
              <span>Insurance Provider:</span>
              <strong>{claim.provider}</strong>
            </div>
            <div className="info-row">
              <span>Claim Date:</span>
              <strong>{claim.claimDate}</strong>
            </div>
            <div className="info-row">
              <span>Status:</span>
              <strong className={`status ${claim.status.toLowerCase()}`}>{claim.status}</strong>
            </div>
          </div>
          
          <div className="encryption-section">
            <h3>FHE Encrypted Data</h3>
            <div className="data-row">
              <div className="data-label">Claim Amount:</div>
              <div className="data-value">
                {claim.isVerified && claim.decryptedValue ? 
                  `$${claim.decryptedValue.toLocaleString()} (Verified)` : 
                  localDecrypted !== null ? 
                  `$${localDecrypted.toLocaleString()} (Decrypted)` : 
                  "🔒 Encrypted Amount"
                }
              </div>
              <button 
                className={`decrypt-btn ${(claim.isVerified || localDecrypted !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting || claim.isVerified}
              >
                {isDecrypting ? "Decrypting..." : claim.isVerified ? "Verified" : "Decrypt"}
              </button>
            </div>
          </div>
          
          <div className="fhe-explanation">
            <h4>🔐 How FHE Protects Privacy</h4>
            <p>Your claim amount is encrypted using Fully Homomorphic Encryption, allowing fraud detection without revealing sensitive financial data to other insurers.</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;

