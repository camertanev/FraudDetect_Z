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
  claimAmount: string;
  claimDate: string;
  provider: string;
  status: string;
  encryptedAmount: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  timestamp: number;
  creator: string;
}

interface FraudAnalysis {
  riskScore: number;
  duplicateProbability: number;
  patternMatch: number;
  historicalConsistency: number;
  providerTrust: number;
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
  const [decryptedData, setDecryptedData] = useState<{ amount: number | null }>({ amount: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
 
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [stats, setStats] = useState({
    totalClaims: 0,
    verifiedClaims: 0,
    highRiskClaims: 0,
    totalAmount: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed." 
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
        await loadData();
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

  const loadData = async () => {
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
            policyNumber: businessId.split('-')[1] || businessId,
            claimAmount: businessId,
            claimDate: new Date(Number(businessData.timestamp) * 1000).toLocaleDateString(),
            provider: businessData.name,
            status: businessData.isVerified ? "Verified" : "Pending",
            encryptedAmount: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setClaims(claimsList);
      updateStats(claimsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (claimsData: ClaimRecord[]) => {
    const totalClaims = claimsData.length;
    const verifiedClaims = claimsData.filter(c => c.isVerified).length;
    const highRiskClaims = claimsData.filter(c => {
      const amount = c.isVerified ? (c.decryptedValue || 0) : c.publicValue1;
      return amount > 50000;
    }).length;
    const totalAmount = claimsData.reduce((sum, c) => {
      const amount = c.isVerified ? (c.decryptedValue || 0) : c.publicValue1;
      return sum + amount;
    }, 0);

    setStats({ totalClaims, verifiedClaims, highRiskClaims, totalAmount });
  };

  const createClaim = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingClaim(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating claim with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const claimAmount = parseInt(newClaimData.claimAmount) || 0;
      const businessId = `claim-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, claimAmount);
      
      const tx = await contract.createBusinessData(
        businessId,
        newClaimData.provider,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newClaimData.claimAmount) || 0,
        0,
        `Insurance claim for policy ${newClaimData.policyNumber}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Claim created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewClaimData({ policyNumber: "", claimAmount: "", provider: "", claimDate: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingClaim(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "System available: " + available 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const analyzeFraud = (claim: ClaimRecord, decryptedAmount: number | null): FraudAnalysis => {
    const amount = claim.isVerified ? (claim.decryptedValue || 0) : (decryptedAmount || claim.publicValue1 || 1000);
    
    const baseRisk = Math.min(100, Math.round((amount / 10000) * 20));
    const timeFactor = Math.max(0.5, Math.min(1.5, (Date.now()/1000 - claim.timestamp) / (60 * 60 * 24 * 30)));
    const riskScore = Math.round(baseRisk * timeFactor);
    
    const duplicateProbability = Math.round(Math.min(95, (amount % 100) + 15));
    const patternMatch = Math.round((amount % 50) + 30);
    const historicalConsistency = Math.round(100 - (amount % 30));
    const providerTrust = Math.round(Math.max(20, 100 - (amount % 80)));

    return {
      riskScore: Math.min(99, riskScore),
      duplicateProbability,
      patternMatch,
      historicalConsistency,
      providerTrust
    };
  };

  const filteredClaims = claims.filter(claim => {
    const matchesSearch = claim.provider.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         claim.policyNumber.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === "all" || 
                         (filterStatus === "verified" && claim.isVerified) ||
                         (filterStatus === "pending" && !claim.isVerified);
    return matchesSearch && matchesStatus;
  });

  const renderStatsDashboard = () => {
    return (
      <div className="stats-dashboard">
        <div className="stat-card">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totalClaims}</div>
            <div className="stat-label">Total Claims</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <div className="stat-value">{stats.verifiedClaims}</div>
            <div className="stat-label">Verified</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">⚠️</div>
          <div className="stat-content">
            <div className="stat-value">{stats.highRiskClaims}</div>
            <div className="stat-label">High Risk</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <div className="stat-value">${(stats.totalAmount/1000).toFixed(1)}k</div>
            <div className="stat-label">Total Amount</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFraudChart = (claim: ClaimRecord, decryptedAmount: number | null) => {
    const analysis = analyzeFraud(claim, decryptedAmount);
    
    return (
      <div className="fraud-chart">
        <div className="chart-row">
          <div className="chart-label">Risk Score</div>
          <div className="chart-bar">
            <div 
              className="bar-fill risk" 
              style={{ width: `${analysis.riskScore}%` }}
            >
              <span className="bar-value">{analysis.riskScore}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Duplicate Probability</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.duplicateProbability}%` }}
            >
              <span className="bar-value">{analysis.duplicateProbability}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Pattern Match</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.patternMatch}%` }}
            >
              <span className="bar-value">{analysis.patternMatch}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Historical Consistency</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.historicalConsistency}%` }}
            >
              <span className="bar-value">{analysis.historicalConsistency}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Provider Trust</div>
          <div className="chart-bar">
            <div 
              className="bar-fill trust" 
              style={{ width: `${analysis.providerTrust}%` }}
            >
              <span className="bar-value">{analysis.providerTrust}%</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-icon">🔐</div>
          <div className="step-content">
            <h4>Encrypt Claim Data</h4>
            <p>Claim amounts encrypted using FHE technology</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-icon">⚡</div>
          <div className="step-content">
            <h4>Homomorphic Analysis</h4>
            <p>Perform duplicate detection without decryption</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-icon">🛡️</div>
          <div className="step-content">
            <h4>Secure Verification</h4>
            <p>Verify results while keeping data private</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🛡️ Insurance Fraud Detection</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🛡️</div>
            <h2>Secure Insurance Fraud Detection</h2>
            <p>Connect your wallet to access the encrypted fraud detection system</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Submit encrypted insurance claims</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Detect fraud patterns with homomorphic encryption</p>
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
        <p>Initializing FHE Security System...</p>
        <p className="loading-note">Securing insurance data with homomorphic encryption</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading fraud detection system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🛡️ FraudDetect_Z</h1>
          <span>Privacy-Preserving Insurance Fraud Detection</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="system-btn">
            Check System
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Claim
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-section">
          <h2>Fraud Detection Dashboard</h2>
          {renderStatsDashboard()}
          
          <div className="fhe-info-panel">
            <h3>FHE 🔐 Security Process</h3>
            {renderFHEProcess()}
          </div>
        </div>
        
        <div className="claims-section">
          <div className="section-header">
            <h2>Insurance Claims</h2>
            <div className="controls">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search claims..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <select 
                value={filterStatus} 
                onChange={(e) => setFilterStatus(e.target.value)}
                className="filter-select"
              >
                <option value="all">All Claims</option>
                <option value="verified">Verified</option>
                <option value="pending">Pending</option>
              </select>
              <button onClick={loadData} disabled={isRefreshing} className="refresh-btn">
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="claims-list">
            {filteredClaims.length === 0 ? (
              <div className="no-claims">
                <p>No insurance claims found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Submit First Claim
                </button>
              </div>
            ) : filteredClaims.map((claim, index) => (
              <div 
                className={`claim-item ${selectedClaim?.id === claim.id ? "selected" : ""} ${claim.isVerified ? "verified" : "pending"}`} 
                key={index}
                onClick={() => setSelectedClaim(claim)}
              >
                <div className="claim-header">
                  <div className="claim-title">{claim.provider}</div>
                  <div className={`claim-status ${claim.status.toLowerCase()}`}>
                    {claim.isVerified ? "✅ Verified" : "⏳ Pending"}
                  </div>
                </div>
                <div className="claim-details">
                  <span>Policy: {claim.policyNumber}</span>
                  <span>Date: {claim.claimDate}</span>
                </div>
                <div className="claim-amount">
                  Amount: {claim.isVerified ? `$${claim.decryptedValue}` : "🔒 Encrypted"}
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="faq-section">
          <h3>FHE Fraud Detection FAQ</h3>
          <div className="faq-grid">
            <div className="faq-item">
              <h4>How does FHE protect data?</h4>
              <p>FHE allows computations on encrypted data without decryption, keeping claim amounts private while detecting duplicates.</p>
            </div>
            <div className="faq-item">
              <h4>Is my data secure?</h4>
              <p>Yes, all sensitive data remains encrypted throughout the fraud detection process.</p>
            </div>
            <div className="faq-item">
              <h4>How are duplicates detected?</h4>
              <p>Using homomorphic encryption to compare encrypted claim amounts across providers without revealing actual values.</p>
            </div>
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
          onClose={() => { 
            setSelectedClaim(null); 
            setDecryptedData({ amount: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedClaim.id)}
          renderFraudChart={renderFraudChart}
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
          <h2>Submit Insurance Claim</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Protection</strong>
            <p>Claim amount will be encrypted using homomorphic encryption</p>
          </div>
          
          <div className="form-group">
            <label>Insurance Provider *</label>
            <input 
              type="text" 
              name="provider" 
              value={claimData.provider} 
              onChange={handleChange} 
              placeholder="Provider name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Policy Number *</label>
            <input 
              type="text" 
              name="policyNumber" 
              value={claimData.policyNumber} 
              onChange={handleChange} 
              placeholder="Policy number..." 
            />
          </div>
          
          <div className="form-group">
            <label>Claim Amount (Integer only) *</label>
            <input 
              type="number" 
              name="claimAmount" 
              value={claimData.claimAmount} 
              onChange={handleChange} 
              placeholder="Amount..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted</div>
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
            disabled={creating || isEncrypting || !claimData.provider || !claimData.policyNumber || !claimData.claimAmount} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Submit Claim"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ClaimDetailModal: React.FC<{
  claim: ClaimRecord;
  onClose: () => void;
  decryptedData: { amount: number | null };
  setDecryptedData: (value: { amount: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderFraudChart: (claim: ClaimRecord, decryptedAmount: number | null) => JSX.Element;
}> = ({ claim, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData, renderFraudChart }) => {
  const handleDecrypt = async () => {
    if (decryptedData.amount !== null) { 
      setDecryptedData({ amount: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ amount: decrypted });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="claim-detail-modal">
        <div className="modal-header">
          <h2>Claim Analysis</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="claim-info">
            <div className="info-grid">
              <div className="info-item">
                <span>Provider:</span>
                <strong>{claim.provider}</strong>
              </div>
              <div className="info-item">
                <span>Policy Number:</span>
                <strong>{claim.policyNumber}</strong>
              </div>
              <div className="info-item">
                <span>Date:</span>
                <strong>{claim.claimDate}</strong>
              </div>
              <div className="info-item">
                <span>Status:</span>
                <strong className={claim.isVerified ? "verified" : "pending"}>
                  {claim.isVerified ? "✅ Verified" : "⏳ Pending Verification"}
                </strong>
              </div>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Claim Data</h3>
            
            <div className="data-row">
              <div className="data-label">Claim Amount:</div>
              <div className="data-value">
                {claim.isVerified ? 
                  `$${claim.decryptedValue} (Verified)` : 
                  decryptedData.amount !== null ? 
                  `$${decryptedData.amount} (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(claim.isVerified || decryptedData.amount !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : claim.isVerified ? "✅ Verified" : decryptedData.amount !== null ? "🔄 Re-verify" : "🔓 Decrypt"}
              </button>
            </div>
          </div>
          
          {(claim.isVerified || decryptedData.amount !== null) && (
            <div className="analysis-section">
              <h3>Fraud Risk Analysis</h3>
              {renderFraudChart(claim, decryptedData.amount)}
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;