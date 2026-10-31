import * as Tedious from "tedious";

export const connectionConfig: Tedious.ConnectionConfiguration = {
   server:                     process.env.TEDIOUS_PLUS_TEST_SERVER ?? "localhost",
   authentication: {
      type:                    "default",
      options: {
         userName:             process.env.TEDIOUS_PLUS_TEST_USERNAME ?? "sa",
         password:             process.env.TEDIOUS_PLUS_TEST_PASSWORD ?? "sesame" }},
   options: {
      database:                process.env.TEDIOUS_PLUS_TEST_DATABASE ?? "master",
      trustServerCertificate:  true,
      abortTransactionOnError: true,
      appName:                 "tedious-plus-test" }};
