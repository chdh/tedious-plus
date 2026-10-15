import * as Tedious from "tedious";

export const connectionConfig: Tedious.ConnectionConfiguration = {
   server:                     "localhost",
   authentication: {
      type:                    "default",
      options: {
         userName:             process.env.TEDIOUS_PLUS_TEST_USERNAME ?? "tedious",
         password:             process.env.TEDIOUS_PLUS_TEST_PASSWORD ?? "sesame" }},
   options: {
      database:                "tediousTest",
      trustServerCertificate:  true,
      abortTransactionOnError: true,
      appName:                 "tedious-plus-test" }};
