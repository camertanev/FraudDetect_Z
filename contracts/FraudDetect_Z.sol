pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract UniversalFHEAdapter is ZamaEthereumConfig {
    
    struct BusinessData {
        string name;                    
        euint32 encryptedValue;        
        uint256 publicValue1;          
        uint256 publicValue2;          
        string description;            
        address creator;               
        uint256 timestamp;             
        uint32 decryptedValue; 
        bool isVerified; 
    }
    

    mapping(string => BusinessData) public businessData;
    
    string[] public businessIds;
    
    event BusinessDataCreated(string indexed businessId, address indexed creator);
    event DecryptionVerified(string indexed businessId, uint32 decryptedValue);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function createBusinessData(
        string calldata businessId,
        string calldata name,
        externalEuint32 encryptedValue,
        bytes calldata inputProof,
        uint256 publicValue1,
        uint256 publicValue2,
        string calldata description
    ) external {
        require(bytes(businessData[businessId].name).length == 0, "Business data already exists");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedValue, inputProof)), "Invalid encrypted input");
        
        businessData[businessId] = BusinessData({
            name: name,
            encryptedValue: FHE.fromExternal(encryptedValue, inputProof),
            publicValue1: publicValue1,
            publicValue2: publicValue2,
            description: description,
            creator: msg.sender,
            timestamp: block.timestamp,
            decryptedValue: 0,
            isVerified: false
        });
        
        FHE.allowThis(businessData[businessId].encryptedValue);
        
        FHE.makePubliclyDecryptable(businessData[businessId].encryptedValue);
        
        businessIds.push(businessId);
        
        emit BusinessDataCreated(businessId, msg.sender);
    }
    
    function verifyDecryption(
        string calldata businessId, 
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(businessData[businessId].name).length > 0, "Business data does not exist");
        require(!businessData[businessId].isVerified, "Data already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(businessData[businessId].encryptedValue);
        
        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        
        businessData[businessId].decryptedValue = decodedValue;
        businessData[businessId].isVerified = true;
        
        emit DecryptionVerified(businessId, decodedValue);
    }
    
    function getEncryptedValue(string calldata businessId) external view returns (euint32) {
        require(bytes(businessData[businessId].name).length > 0, "Business data does not exist");
        return businessData[businessId].encryptedValue;
    }
    
    function getBusinessData(string calldata businessId) external view returns (
        string memory name,
        uint256 publicValue1,
        uint256 publicValue2,
        string memory description,
        address creator,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedValue
    ) {
        require(bytes(businessData[businessId].name).length > 0, "Business data does not exist");
        BusinessData storage data = businessData[businessId];
        
        return (
            data.name,
            data.publicValue1,
            data.publicValue2,
            data.description,
            data.creator,
            data.timestamp,
            data.isVerified,
            data.decryptedValue
        );
    }
    
    function getAllBusinessIds() external view returns (string[] memory) {
        return businessIds;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}

