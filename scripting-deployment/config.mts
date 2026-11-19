import {type ConnectionConfiguration} from "tedious";

export const connectionConfig: ConnectionConfiguration = {
   server:                     process.env.TEDIOUS_PLUS_SCRIPT_SERVER ?? "localhost",
   authentication: {
      type:                    "default",
      options: {
         userName:             process.env.TEDIOUS_PLUS_SCRIPT_USERNAME ?? "sa",
         password:             process.env.TEDIOUS_PLUS_SCRIPT_PASSWORD ?? "sesame"
      }
   },
   options: {
      database:                process.env.TEDIOUS_PLUS_SCRIPT_DATABASE ?? "master",
      trustServerCertificate:  true,
         // Accepts a self-signed server certificate, e.g. of a local development server.
      abortTransactionOnError: true,
      appName:                 "tedious-plus-script"
   }
};
