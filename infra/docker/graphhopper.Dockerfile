FROM eclipse-temurin:21-jre
ARG GRAPHHOPPER_VERSION=11.0
ADD https://repo1.maven.org/maven2/com/graphhopper/graphhopper-web/${GRAPHHOPPER_VERSION}/graphhopper-web-${GRAPHHOPPER_VERSION}.jar /opt/graphhopper/graphhopper-web.jar
COPY infra/graphhopper/config.yml /opt/graphhopper/config.yml
COPY infra/graphhopper/custom_models /opt/graphhopper/custom_models
COPY infra/graphhopper/entrypoint.sh /opt/graphhopper/entrypoint.sh
RUN chmod 0644 /opt/graphhopper/graphhopper-web.jar && chmod +x /opt/graphhopper/entrypoint.sh
EXPOSE 8989
HEALTHCHECK --interval=30s --timeout=5s --start-period=10m CMD wget -qO- http://localhost:8989/health || exit 1
ENTRYPOINT ["/opt/graphhopper/entrypoint.sh"]
