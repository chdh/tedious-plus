import {type ConnectionConfiguration} from "tedious";

export const connectionConfig: ConnectionConfiguration = {
   server:                     process.env.TEDIOUS_PLUS_EXAMPLE_SERVER ?? "localhost",
   authentication: {
      type:                    "default",
      options: {
         userName:             process.env.TEDIOUS_PLUS_EXAMPLE_USERNAME ?? "sa",
         password:             process.env.TEDIOUS_PLUS_EXAMPLE_PASSWORD ?? "sesame"
      }
   },
   options: {
      database:                process.env.TEDIOUS_PLUS_EXAMPLE_DATABASE ?? "master",
      // Accepts a self-signed server certificate, e.g. of a local development server. Don't use this in production.
      trustServerCertificate:  true,
      abortTransactionOnError: true,
      appName:                 "tedious-plus-examples"
   }
};
