Jaeger is a distributed tracing solution used to trace request from different systems(https://www.jaegertracing.io/docs/1.29/). It uses open telemetry approach to create span contexts and create distributed traces

1. Update the jaeger-values.yml file with the proper elastic search configuration.

2. Install jaeger as daemonset using the following helm command:

   `helm install jaeger-tracing jaegertracing/jaeger -f jaeger-values.yml`

   - this will install 2 jaeger components agent,query-ui,collector.

3. Install otel - open telemetry collector to collect traces from front end and pass it to jaeger.

   `kubectl apply -f otel-deployment.yml`

4. Get the jaeger UI ip :

   `kubectl get service --field-selector metadata.name=jaeger-tracing-query`

   open the ip in the browser and look for traces.
5 Login to the elastic search and create Indexes for Jaeger-service and Jaegre-span

# Code changes :

# Angular :

1. Install the following dependencies :

` npm install  @opentelemetry/api@1.0.3 @opentelemetry/sdk-trace-web @opentelemetry/sdk-trace-base @opentelemetry/core @opentelemetry/semantic-conventions @opentelemetry/resources @opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-zipkin @opentelemetry/propagator-b3 @opentelemetry/propagator-jaeger @opentelemetry/context-zone-peer-dep @opentelemetry/instrumentation @opentelemetry/instrumentation-document-load @opentelemetry/instrumentation-fetch @opentelemetry/instrumentation-xml-http-request --save-dev`

2. Add 'open-telemetry-interceptor.ts' to the project

3. Add the following open-telemetry configuration to the environemt.Update the serviceName as per the project requirement.This service name helps to filter the project spanS in the jaguer UI. ex:'dashboard-ui'

   '''
   commonConfig: {
      console: true, // Display trace on console
      production: true, // Send Trace with BatchSpanProcessor (true) or SimpleSpanProcessor (false)
      serviceName: 'jaeger-test', // Service name send in trace
      logBody: true, // true add body in a log, nothing otherwise
      probabilitySampler: '1', // 75% sampling
      logLevel: DiagLogLevel.ALL //ALL Log, DiagLogLevel is an Enum from @opentelemetry/api
    },
    otelcolConfig: {
      url: 'http://otel-collector.default.svc.cluster.local:4318/v1/traces', // URL of opentelemetry collector
      attributes: {
        test: 'test'
      }
    }
  },

  '''

3. Add the interceptor to the app.module.ts

       ```
        providers: [
      {
       provide: HTTP_INTERCEPTORS,
       useClass: OpenTelemetryHttpInterceptor,
       multi: true,
      },
       ],
       ```

   ```

4. Traces should occur in the jaeger ui from front ends

# asp.net core:

1.  Add the following nuget package dependencies:

          <PackageReference Include="OpenTelemetry.Exporter.Console" Version="1.2.0-rc1" />
          <PackageReference Include="OpenTelemetry.Exporter.Jaeger" Version="1.2.0-rc1" />
          <PackageReference Include="OpenTelemetry.Exporter.Prometheus" Version="1.2.0-rc1" />
          <PackageReference Include="OpenTelemetry.Extensions.Hosting" Version="1.0.0-rc8" />
          <PackageReference Include="OpenTelemetry.Instrumentation.AspNetCore" Version="1.0.0-rc8" />
          <PackageReference Include="OpenTelemetry.Instrumentation.Http" Version="1.0.0-rc8" />

2.  update the startup.cs as below:

          ``` services.AddOpenTelemetryTracing((builder) => builder
                   .SetResourceBuilder(ResourceBuilder.CreateDefault().AddService(this.Configuration.GetValue<string>("service-name")))
                   .AddAspNetCoreInstrumentation()
                   .AddHttpClientInstrumentation()
                   .AddConsoleExporter()
                   .AddJaegerExporter((op) =>
                   {
                       op.AgentHost = "jaeger-tracing-agent.default.svc.cluster.local";
                       op.AgentPort = 6831;
                       op.Protocol = JaegerExportProtocol.UdpCompactThrift;
                   }));
          ```

3.  The service-name and AgentHost can be configured and retrieved from appsettings.

4.  Add CORS policy to allow open telemetry headers. **These headres is to allow tracesfrom front-end and connect with backend**.

        ``` builder.WithHeaders(new string[]
                                   {"x-b3-traceid","traceparent",
                                       "x-amzn-trace-id","x-b3-spanid","x-b3-sampled","uber-trace-id" });

          ```

```

```
