ARG PISTON_BASE_IMAGE=piston-local
FROM ${PISTON_BASE_IMAGE}

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends r-base-core \
    && rm -rf /var/lib/apt/lists/*

COPY repair-r-runtime.sh /usr/local/bin/repair-r-runtime
RUN chmod 0755 /usr/local/bin/repair-r-runtime

ENTRYPOINT ["/usr/local/bin/repair-r-runtime"]
