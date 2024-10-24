interface TemporalClientOptions {
    address: string;
    tls?: {
      clientCertPair: {
        crt: Buffer;
        key: Buffer;
      };
    };
  }
  
  
export const getTemporalClientOptions = (): TemporalClientOptions => {
    const temporalHostURL = process.env.TEMPORAL_HOST_URL;
  
    if (!temporalHostURL) {
      throw new Error("Temporal Host URL not defined");
    }
  
    const temporalClientOptions: TemporalClientOptions = {
      address: temporalHostURL,
    };
  
    const temporalCert = process.env.TEMPORAL_CERT;
    const temporalCertKey = process.env.TEMPORAL_CERT_KEY
   
    if (temporalCert && temporalCertKey) {
      temporalClientOptions.tls = {
        clientCertPair: {
          crt: Buffer.from(String(temporalCert)),
          key: Buffer.from(String(temporalCertKey)),
        },
      };
    }
 
  
    return temporalClientOptions;
  };
  
  