import autobind from 'autobind-decorator';
import * as React from 'react';
import { DataFilterType, onFilterOptionSelect } from 'react-mutation-mapper';
import { observer } from 'mobx-react';
import { action, computed, makeObservable } from 'mobx';

import { getRemoteDataGroupStatus } from 'cbioportal-utils';
import { EnsemblTranscript } from 'genome-nexus-ts-api-client';
import DiscreteCNACache from 'shared/cache/DiscreteCNACache';
import CancerTypeCache from 'shared/cache/CancerTypeCache';
import MutationCountCache from 'shared/cache/MutationCountCache';

import {
    IMutationMapperProps,
    default as MutationMapper,
} from 'shared/components/mutationMapper/MutationMapper';
import MutationMapperDataStore, {
    MUTATION_STATUS_FILTER_ID,
} from 'shared/components/mutationMapper/MutationMapperDataStore';

import MutationRateSummary from 'pages/resultsView/mutation/MutationRateSummary';
import ResultsViewMutationMapperStore from 'pages/resultsView/mutation/ResultsViewMutationMapperStore';
import { ResultsViewPageStore } from '../ResultsViewPageStore';
import ResultsViewMutationTable from 'pages/resultsView/mutation/ResultsViewMutationTable';

export interface IResultsViewMutationMapperProps extends IMutationMapperProps {
    store: ResultsViewMutationMapperStore;
    discreteCNACache?: DiscreteCNACache;
    cancerTypeCache?: CancerTypeCache;
    mutationCountCache?: MutationCountCache;
    existsSomeMutationWithAscnProperty: { [property: string]: boolean };
    userEmailAddress: string;
    onClickSettingMenu?: () => void;
}

@observer
export default class ResultsViewMutationMapper extends MutationMapper<
    IResultsViewMutationMapperProps
> {
    constructor(props: IResultsViewMutationMapperProps) {
        super(props);
        makeObservable(this);
    }

    @computed get mutationStatusFilter() {
        return this.store.dataStore.dataFilters.find(
            f => f.id === MUTATION_STATUS_FILTER_ID
        );
    }

    protected getMutationRateSummary(): JSX.Element | null {
        // TODO we should not be even calculating mskImpactGermlineConsentedPatientIds for studies other than msk impact
        if (
            this.props.store.germlineConsentedSamples &&
            this.props.store.germlineConsentedSamples.result &&
            this.props.store.mutationData.isComplete &&
            this.props.store.mutationData.result.length > 0
        ) {
            return (
                <MutationRateSummary
                    hugoGeneSymbol={this.props.store.gene.hugoGeneSymbol}
                    molecularProfileIdToMolecularProfile={
                        this.props.store.molecularProfileIdToMolecularProfile
                    }
                    mutations={this.props.store.mutationData.result}
                    samples={this.props.store.samples.result!}
                    germlineConsentedSamples={
                        this.props.store.germlineConsentedSamples
                    }
                    onMutationStatusSelect={this.onMutationStatusSelect}
                    mutationStatusFilter={this.mutationStatusFilter}
                />
            );
        } else {
            return null;
        }
    }

    protected get isMutationTableDataLoading() {
        return (
            getRemoteDataGroupStatus(
                this.props.store.clinicalDataForSamples,
                this.props.store.studiesForSamplesWithoutCancerTypeClinicalData,
                this.props.store.canonicalTranscript,
                this.props.store.mutationData,
                this.props.store.indexedVariantAnnotations,
                this.props.store.activeTranscript,
                this.props.store.clinicalDataGroupedBySampleMap
            ) === 'pending'
        );
    }

    protected get totalExonNumber() {
        const canonicalTranscriptId =
            this.props.store.canonicalTranscript.result &&
            this.props.store.canonicalTranscript.result.transcriptId;
        const transcript = (this.props.store.activeTranscript.result &&
        this.props.store.activeTranscript.result === canonicalTranscriptId
            ? this.props.store.canonicalTranscript.result
            : this.props.store.transcriptsByTranscriptId[
                  this.props.store.activeTranscript.result!
              ]) as EnsemblTranscript;
        return transcript && transcript.exons && transcript.exons.length > 0
            ? transcript.exons.length.toString()
            : 'None';
    }

    protected get mutationTableComponent(): JSX.Element | null {
        return (
            <ResultsViewMutationTable
                uniqueSampleKeyToTumorType={
                    this.props.store.uniqueSampleKeyToTumorType
                }
                oncoKbCancerGenes={this.props.store.oncoKbCancerGenes}
                discreteCNACache={this.props.discreteCNACache}
                studyIdToStudy={this.props.store.studyIdToStudy.result}
                molecularProfileIdToMolecularProfile={
                    this.props.store.molecularProfileIdToMolecularProfile.result
                }
                pubMedCache={this.props.pubMedCache}
                mutationCountCache={this.props.mutationCountCache}
                genomeNexusCache={this.props.genomeNexusCache}
                genomeNexusMutationAssessorCache={
                    this.props.genomeNexusMutationAssessorCache
                }
                dataStore={
                    this.props.store.dataStore as MutationMapperDataStore
                }
                itemsLabelPlural={this.itemsLabelPlural}
                downloadDataFetcher={this.props.store.downloadDataFetcher}
                myCancerGenomeData={this.props.store.myCancerGenomeData}
                hotspotData={this.props.store.indexedHotspotData}
                indexedVariantAnnotations={
                    this.props.store.indexedVariantAnnotations
                }
                indexedMyVariantInfoAnnotations={
                    this.props.store.indexedMyVariantInfoAnnotations
                }
                cosmicData={this.props.store.cosmicData.result}
                oncoKbData={this.props.store.oncoKbData}
                usingPublicOncoKbInstance={
                    this.props.store.usingPublicOncoKbInstance
                }
                civicGenes={this.props.store.civicGenes}
                civicVariants={this.props.store.civicVariants}
                userEmailAddress={this.props.userEmailAddress}
                enableOncoKb={this.props.enableOncoKb}
                enableFunctionalImpact={this.props.enableGenomeNexus}
                enableHotspot={this.props.enableHotspot}
                enableMyCancerGenome={this.props.enableMyCancerGenome}
                enableCivic={this.props.enableCivic}
                totalNumberOfExons={this.totalExonNumber}
                generateGenomeNexusHgvsgUrl={
                    this.props.store.generateGenomeNexusHgvsgUrl
                }
                isCanonicalTranscript={this.props.store.isCanonicalTranscript}
                selectedTranscriptId={this.props.store.activeTranscript.result}
                sampleIdToClinicalDataMap={
                    this.props.store.clinicalDataGroupedBySampleMap
                }
                existsSomeMutationWithAscnProperty={
                    this.props.existsSomeMutationWithAscnProperty
                }
            />
        );
    }

    protected get mutationTable(): JSX.Element | null {
        return (
            <span>
                {!this.isMutationTableDataLoading &&
                    this.mutationTableComponent}
            </span>
        );
    }

    @action.bound
    protected onMutationStatusSelect(
        selectedMutationStatusIds: string[],
        allValuesSelected: boolean
    ) {
        onFilterOptionSelect(
            selectedMutationStatusIds,
            allValuesSelected,
            this.store.dataStore,
            DataFilterType.MUTATION_STATUS,
            MUTATION_STATUS_FILTER_ID
        );
    }
}
