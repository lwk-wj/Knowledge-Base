# Official Elasticsearch base image
FROM elasticsearch:8.17.0

# Install IK analysis plugin matching the Elasticsearch version.
RUN elasticsearch-plugin install --batch \
    https://release.infinilabs.com/analysis-ik/stable/elasticsearch-analysis-ik-8.17.0.zip
