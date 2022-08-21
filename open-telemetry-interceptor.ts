import { Injectable, Inject, Optional, InjectionToken } from '@angular/core';
import {
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpInterceptor,
  HttpResponse,
  HttpErrorResponse
} from '@angular/common/http';
import { PlatformLocation } from '@angular/common';
import { Observable } from 'rxjs';
import * as api from '@opentelemetry/api';
import { Sampler, Span, SpanStatusCode, DiagLogger, DiagLogLevel } from '@opentelemetry/api';
import { WebTracerProvider, StackContextManager } from '@opentelemetry/sdk-trace-web';
import { JaegerPropagator } from '@opentelemetry/propagator-jaeger';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { B3Propagator, B3PropagatorConfig, B3InjectEncoding } from '@opentelemetry/propagator-b3';
import { OTLPExporterConfigBase } from '@opentelemetry/exporter-trace-otlp-http/build/src/types';
import {
  SimpleSpanProcessor,
  ConsoleSpanExporter,
  BatchSpanProcessor,
  NoopSpanProcessor,
  BufferConfig
} from '@opentelemetry/sdk-trace-base';
import {
  AlwaysOnSampler,
  AlwaysOffSampler,
  TraceIdRatioBasedSampler,
  ParentBasedSampler,
  W3CTraceContextPropagator,
  CompositePropagator,
} from '@opentelemetry/core';
import { SemanticResourceAttributes, SemanticAttributes } from '@opentelemetry/semantic-conventions';
import { Resource } from '@opentelemetry/resources'
import { environment } from 'src/environments/environment';;
import { tap, finalize } from 'rxjs/operators';



/**
 * OpenTelemetryInterceptor class
 */
@Injectable({
  providedIn: 'root',
})
export class OpenTelemetryHttpInterceptor implements HttpInterceptor {
  /**
   * tracer
   */
  tracer: WebTracerProvider;
  /**
   * context manager
   */
  contextManager: StackContextManager;
  /**
   * Log or not body
   */
  logBody = false;

  OTLP_LOGGER = new InjectionToken<DiagLogger>('otelcol.logger');
  b3PropagatorConfig: B3PropagatorConfig ={};

  constructor(
    private platformLocation: PlatformLocation
  ) {
    this.tracer = new WebTracerProvider({
      sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(1) }),
      resource: Resource.default().merge(
        new Resource({
          [SemanticResourceAttributes.SERVICE_NAME]:environment.openTelemetryConfig.commonConfig.serviceName,
        })
      ),
    });
    this.insertOrNotSpanExporter();
    this.contextManager = new StackContextManager();
    this.b3PropagatorConfig = {
    injectEncoding:B3InjectEncoding.MULTI_HEADER
    };
    this.tracer.register({      
      propagator:new CompositePropagator({
        propagators: [
          new B3Propagator(this.b3PropagatorConfig),
          new W3CTraceContextPropagator(),
          new JaegerPropagator()          
        ],
      }),
      contextManager: this.contextManager
    });
    this.logBody = true;
    //api.diag.setLogger(logger, DiagLogLevel.ALL);
  }

  /**
   * Overide methd
   * Interceptor from HttpInterceptor Angular
   *
   * @param request the current request
   * @param next next
   */
  intercept(
    request: HttpRequest<unknown>,
    next: HttpHandler
  ): Observable<HttpEvent<unknown>> {
    this.contextManager.disable(); //FIX - reinit contextManager for each http call
    this.contextManager.enable();
    const span: Span = this.initSpan(request);
    const tracedReq = this.injectContextAndHeader(request);
    return next.handle(tracedReq).pipe(
      tap(
        (event: HttpEvent<any>) => {
            if (event instanceof HttpResponse) {
                span.setAttributes( {
                 [SemanticAttributes.HTTP_STATUS_CODE]: event.status,
               });
            }
        },
        (event: HttpErrorResponse) => {
            if (event instanceof HttpErrorResponse) {
             span.setAttributes(
                 {
                   [SemanticAttributes.HTTP_STATUS_CODE]: event.status,
                 }
               );
               span.recordException({
                 name: event.name,
                 message: event.message,
                 stack: event.error
               });
               span.setStatus({
                 code: SpanStatusCode.ERROR
               });
            }
        }
      ),
    finalize(() => {
        span.end();
        console.log(tracedReq)
    })
    );
  }

  /**
   * Get current scheme, hostname and port
   */
  private getURL() {
    return this.platformLocation.href;
  }

  /**
   * Initialise a span for a request intercepted
   *
   * @param request request
   */
  private initSpan(request: HttpRequest<unknown>): Span {
    const urlRequest = (request.urlWithParams.startsWith('http')) ? new URL(request.urlWithParams) : new URL(this.getURL());
    const span = this.tracer
      .getTracer("test", "1.0.0")
      .startSpan(
        `${urlRequest.protocol.replace(':', '').toUpperCase()} ${request.method.toUpperCase()}`,
        {
          attributes: {
            [SemanticAttributes.HTTP_METHOD]: request.method,
            [SemanticAttributes.HTTP_URL]: request.urlWithParams,
            [SemanticAttributes.HTTP_HOST]: urlRequest.host,
            [SemanticAttributes.HTTP_SCHEME]: urlRequest.protocol.replace(':', ''),
            [SemanticAttributes.HTTP_TARGET]: urlRequest.pathname + urlRequest.search,
            [SemanticAttributes.HTTP_USER_AGENT]: window.navigator.userAgent
          },
          kind: api.SpanKind.CLIENT,
        },
        this.contextManager.active()
      );
    /*eslint no-underscore-dangle: ["error", { "allow": ["_currentContext"] }]*/
    this.contextManager._currentContext = api.trace.setSpan(
      this.contextManager.active(),
      span
    );
    return span;
  }

  /**
   * Add header propagator in request and conserve original header
   *
   * @param request request
   */
  private injectContextAndHeader(
    request: HttpRequest<unknown>
  ) {
    const carrier:any = {};
    debugger
    api.propagation.inject(
      this.contextManager.active(),
      carrier,
      api.defaultTextMapSetter
    );
    request.headers.keys().map(key => {
      carrier[key] = request.headers.get(key);
    });
    return request.clone({
      setHeaders: carrier,
    });
  }

  /**
   * Verify to insert or not a Span Exporter
   */
  private insertOrNotSpanExporter() {  
    this.tracer.addSpanProcessor(
      new SimpleSpanProcessor(new ConsoleSpanExporter())
    ); 
      this.insertSpanProcessorProductionMode();     
  }


  /**
   * Insert BatchSpanProcessor in production mode
   * SimpleSpanProcessor otherwise
   */
  private insertSpanProcessorProductionMode() {  
    const otelcolConfig:OTLPExporterConfigBase= {
      url:environment.openTelemetryConfig.otelcolConfig.url,      
      concurrencyLimit: Number(10)
    }
    
    this.tracer.addSpanProcessor(
        new BatchSpanProcessor(new OTLPTraceExporter(otelcolConfig))        
    );
  }
}