import {
    CancerStudy,
    ClinicalAttribute,
    ClinicalAttributeCount,
    ClinicalAttributeCountFilter,
    ClinicalData,
    ClinicalDataMultiStudyFilter,
    ClinicalDataSingleStudyFilter,
    CopyNumberSeg,
    CosmicMutation,
    DiscreteCopyNumberData,
    DiscreteCopyNumberFilter,
    Gene,
    GenericAssayData,
    GenericAssayDataMultipleStudyFilter,
    GenericAssayMeta,
    Geneset,
    GenesetDataFilterCriteria,
    GenesetMolecularData,
    MolecularDataFilter,
    MolecularDataMultipleStudyFilter,
    MolecularProfile,
    MolecularProfileFilter,
    Mutation,
    MutationCountByPosition,
    MutationFilter,
    MutationMultipleStudyFilter,
    NumericGeneMolecularData,
    ReferenceGenomeGene,
    Sample,
    SampleFilter,
    SampleIdentifier,
    SampleList,
    SampleMolecularIdentifier,
    StructuralVariant,
    StructuralVariantFilter,
} from 'cbioportal-ts-api-client';
import client from 'shared/api/cbioportalClientInstance';
import {
    CanonicalMutationType,
    remoteData,
    stringListToSet,
} from 'cbioportal-frontend-commons';
import {
    action,
    computed,
    observable,
    ObservableMap,
    reaction,
    makeObservable,
} from 'mobx';
import {
    getProteinPositionFromProteinChange,
    IHotspotIndex,
    indexHotspotsData,
    IOncoKbData,
    generateQueryStructuralVariantId,
    isLinearClusterHotspot,
} from 'cbioportal-utils';
import {
    GenomeNexusAPI,
    GenomeNexusAPIInternal,
    VariantAnnotation,
} from 'genome-nexus-ts-api-client';
import { CancerGene, IndicatorQueryResp } from 'oncokb-ts-api-client';
import { cached, labelMobxPromises, MobxPromise } from 'mobxpromise';
import PubMedCache from 'shared/cache/PubMedCache';
import GenomeNexusCache from 'shared/cache/GenomeNexusCache';
import GenomeNexusMutationAssessorCache from 'shared/cache/GenomeNexusMutationAssessorCache';
import CancerTypeCache from 'shared/cache/CancerTypeCache';
import MutationCountCache from 'shared/cache/MutationCountCache';
import DiscreteCNACache from 'shared/cache/DiscreteCNACache';
import PdbHeaderCache from 'shared/cache/PdbHeaderCache';
import {
    evaluateDiscreteCNAPutativeDriverInfo,
    evaluateMutationPutativeDriverInfo,
    existsSomeMutationWithAscnPropertyInCollection,
    fetchAllReferenceGenomeGenes,
    fetchCnaOncoKbDataForOncoprint,
    fetchCopyNumberSegmentsForSamples,
    fetchGenes,
    fetchGermlineConsentedSamples,
    fetchOncoKbCancerGenes,
    fetchOncoKbDataForOncoprint,
    fetchStudiesForSamplesWithoutCancerTypeClinicalData,
    fetchSurvivalDataExists,
    fetchVariantAnnotationsIndexedByGenomicLocation,
    filterAndAnnotateMolecularData,
    filterAndAnnotateMutations,
    generateDataQueryFilter,
    generateUniqueSampleKeyToTumorTypeMap,
    getGenomeNexusUrl,
    getSurvivalClinicalAttributesPrefix,
    groupBy,
    groupBySampleId,
    IDataQueryFilter,
    makeGetOncoKbCnaAnnotationForOncoprint,
    makeGetOncoKbMutationAnnotationForOncoprint,
    makeIsHotspotForOncoprint,
    mapSampleIdToClinicalData,
    ONCOKB_DEFAULT,
    fetchStructuralVariantOncoKbData,
    cancerTypeForOncoKb,
    getOncoKbOncogenic,
} from 'shared/lib/StoreUtils';
import {
    CoverageInformation,
    getCoverageInformation,
} from 'shared/lib/GenePanelUtils';
import { fetchHotspotsData } from 'shared/lib/CancerHotspotsUtils';
import ResultsViewMutationMapperStore from './mutation/ResultsViewMutationMapperStore';
import AppConfig from 'appConfig';
import * as _ from 'lodash';
import { toSampleUuid } from '../../shared/lib/UuidUtils';
import MutationDataCache from '../../shared/cache/MutationDataCache';
import AccessorsForOqlFilter, {
    SimplifiedMutationType,
    getSimplifiedMutationType,
} from '../../shared/lib/oql/AccessorsForOqlFilter';
import {
    doesQueryContainMutationOQL,
    doesQueryContainOQL,
    filterCBioPortalWebServiceData,
    filterCBioPortalWebServiceDataByOQLLine,
    filterCBioPortalWebServiceDataByUnflattenedOQLLine,
    OQLLineFilterOutput,
    UnflattenedOQLLineFilterOutput,
    uniqueGenesInOQLQuery,
} from '../../shared/lib/oql/oqlfilter';
import GeneMolecularDataCache from '../../shared/cache/GeneMolecularDataCache';
import GenesetMolecularDataCache from '../../shared/cache/GenesetMolecularDataCache';
import GenesetCorrelatedGeneCache from '../../shared/cache/GenesetCorrelatedGeneCache';
import GenericAssayMolecularDataCache from '../../shared/cache/GenericAssayMolecularDataCache';
import GeneCache from '../../shared/cache/GeneCache';
import GenesetCache from '../../shared/cache/GenesetCache';
import internalClient from '../../shared/api/cbioportalInternalClientInstance';
import memoize from 'memoize-weak-decorator';
import request from 'superagent';
import {
    countMutations,
    mutationCountByPositionKey,
} from './mutationCountHelpers';
import { CancerStudyQueryUrlParams } from 'shared/components/query/QueryStore';
import {
    compileMutations,
    computeCustomDriverAnnotationReport,
    createDiscreteCopyNumberDataKey,
    DEFAULT_GENOME,
    excludeSpecialMolecularProfiles,
    ExtendedClinicalAttribute,
    fetchPatients,
    fetchQueriedStudies,
    FilteredAndAnnotatedMutationsReport,
    filterSubQueryData,
    getExtendsClinicalAttributesFromCustomData,
    getMolecularProfiles,
    getSampleAlteredMap,
    groupDataByCase,
    initializeCustomDriverAnnotationSettings,
    isRNASeqProfile,
    OncoprintAnalysisCaseType,
    parseGenericAssayGroups,
    filterAndAnnotateStructuralVariants,
    compileStructuralVariants,
    FilteredAndAnnotatedStructuralVariantsReport,
} from './ResultsViewPageStoreUtils';
import MobxPromiseCache from '../../shared/lib/MobxPromiseCache';
import { isSampleProfiledInMultiple } from '../../shared/lib/isSampleProfiled';
import ClinicalDataCache, {
    clinicalAttributeIsINCOMPARISONGROUP,
    clinicalAttributeIsPROFILEDIN,
    SpecialAttribute,
} from '../../shared/cache/ClinicalDataCache';
import { getDefaultMolecularProfiles } from '../../shared/lib/getDefaultMolecularProfiles';
import {
    parseSamplesSpecifications,
    populateSampleSpecificationsFromVirtualStudies,
    ResultsViewTab,
    substitutePhysicalStudiesForVirtualStudies,
} from './ResultsViewPageHelpers';
import {
    filterAndSortProfiles,
    getGenesetProfiles,
    sortRnaSeqProfilesToTop,
} from './coExpression/CoExpressionTabUtils';
import { generateDownloadFilenamePrefixByStudies } from 'shared/lib/FilenameUtils';
import {
    convertComparisonGroupClinicalAttribute,
    makeComparisonGroupClinicalAttributes,
    makeProfiledInClinicalAttributes,
} from '../../shared/components/oncoprint/ResultsViewOncoprintUtils';
import { annotateAlterationTypes } from '../../shared/lib/oql/annotateAlterationTypes';
import { ErrorMessages } from '../../shared/enums/ErrorEnums';
import sessionServiceClient from '../../shared/api/sessionServiceInstance';
import { VirtualStudy } from 'shared/model/VirtualStudy';
import comparisonClient from '../../shared/api/comparisonGroupClientInstance';
import {
    Group,
    Session,
    SessionGroupData,
} from '../../shared/api/ComparisonGroupClient';
import { AppStore } from '../../AppStore';
import { getNumSamples } from '../groupComparison/GroupComparisonUtils';
import autobind from 'autobind-decorator';
import {
    ChartMeta,
    ChartMetaDataTypeEnum,
    getChartMetaDataType,
    getDefaultPriorityByUniqueKey,
    getFilteredStudiesWithSamples,
    getPriorityByClinicalAttribute,
    getUniqueKey,
    getUniqueKeyFromMolecularProfileIds,
    SpecialChartsUniqueKeyEnum,
    StudyWithSamples,
} from 'pages/studyView/StudyViewUtils';
import { IVirtualStudyProps } from 'pages/studyView/virtualStudy/VirtualStudy';
import { decideMolecularProfileSortingOrder } from './download/DownloadUtils';
import ResultsViewURLWrapper from 'pages/resultsView/ResultsViewURLWrapper';
import { ChartTypeEnum } from 'pages/studyView/StudyViewConfig';
import {
    fetchGenericAssayDataByStableIdsAndMolecularIds,
    fetchGenericAssayMetaByMolecularProfileIdsGroupedByGenericAssayType,
    fetchGenericAssayMetaByMolecularProfileIdsGroupByMolecularProfileId,
    COMMON_GENERIC_ASSAY_PROPERTY,
    getGenericAssayMetaPropertyOrDefault,
} from 'shared/lib/GenericAssayUtils/GenericAssayCommonUtils';
import { createVariantAnnotationsByMutationFetcher } from 'shared/components/mutationMapper/MutationMapperUtils';
import { getGenomeNexusHgvsgUrl } from 'shared/api/urls';
import { isMixedReferenceGenome } from 'shared/lib/referenceGenomeUtils';
import {
    ALTERED_COLOR,
    completeSessionGroups,
    getAlteredByOncoprintTrackGroups,
    getAlteredVsUnalteredGroups,
    ResultsViewComparisonGroup,
    UNALTERED_COLOR,
} from './comparison/ResultsViewComparisonUtils';
import { makeUniqueColorGetter } from '../../shared/components/plots/PlotUtils';
import ComplexKeyMap from '../../shared/lib/complexKeyDataStructures/ComplexKeyMap';
import { getSuffixOfMolecularProfile } from 'shared/lib/molecularProfileUtils';
import {
    CLINICAL_ATTRIBUTE_FIELD_ENUM,
    CLINICAL_ATTRIBUTE_ID_ENUM,
    GENETIC_PROFILE_FIELD_ENUM,
    GENOME_NEXUS_ARG_FIELD_ENUM,
    REQUEST_ARG_ENUM,
    SAMPLE_CANCER_TYPE_UNKNOWN,
} from 'shared/constants';
import oql_parser, {
    Alteration,
    SingleGeneQuery,
} from 'shared/lib/oql/oql-parser';
import {
    ANNOTATED_PROTEIN_IMPACT_FILTER_TYPE,
    createAnnotatedProteinImpactTypeFilter,
} from 'shared/lib/MutationUtils';
import ComplexKeyCounter from 'shared/lib/complexKeyDataStructures/ComplexKeyCounter';

type Optional<T> =
    | { isApplicable: true; value: T }
    | { isApplicable: false; value?: undefined };

const DEFAULT_RPPA_THRESHOLD = 2;
const DEFAULT_Z_SCORE_THRESHOLD = 2;

export const AlterationTypeConstants = {
    MUTATION_EXTENDED: 'MUTATION_EXTENDED',
    COPY_NUMBER_ALTERATION: 'COPY_NUMBER_ALTERATION',
    MRNA_EXPRESSION: 'MRNA_EXPRESSION',
    PROTEIN_LEVEL: 'PROTEIN_LEVEL',
    FUSION: 'FUSION',
    GENESET_SCORE: 'GENESET_SCORE',
    METHYLATION: 'METHYLATION',
    GENERIC_ASSAY: 'GENERIC_ASSAY',
    STRUCTURAL_VARIANT: 'STRUCTURAL_VARIANT',
    MUTATION_UNCALLED: 'MUTATION_UNCALLED',
};

export const AlterationTypeDisplayConstants = {
    COPY_NUMBER_ALTERATION: 'CNA',
    MRNA_EXPRESSION: 'EXP',
    PROTEIN_LEVEL: 'PROT',
    MUTATION_EXTENDED: ['MUT', 'FUSION'],
};

export const DataTypeConstants = {
    DISCRETE: 'DISCRETE',
    CONTINUOUS: 'CONTINUOUS',
    ZSCORE: 'Z-SCORE',
    MAF: 'MAF',
    LOGVALUE: 'LOG-VALUE',
    LOG2VALUE: 'LOG2-VALUE',
    LIMITVALUE: 'LIMIT-VALUE',
    FUSION: 'FUSION',
    SV: 'SV',
};

export enum SampleListCategoryType {
    'w_mut' = 'w_mut',
    'w_cna' = 'w_cna',
    'w_mut_cna' = 'w_mut_cna',
}

export enum GeneticEntityType {
    'GENE' = 'GENE',
    'GENESET' = 'GENESET',
    'GENERIC_ASSAY' = 'GENERIC_ASSAY',
    'PHOSPHOPROTEIN' = 'PHOSPHOPROTEIN',
}

export const SampleListCategoryTypeToFullId = {
    [SampleListCategoryType.w_mut]: 'all_cases_with_mutation_data',
    [SampleListCategoryType.w_cna]: 'all_cases_with_cna_data',
    [SampleListCategoryType.w_mut_cna]: 'all_cases_with_mutation_and_cna_data',
};

export type SamplesSpecificationElement =
    | { studyId: string; sampleId: string; sampleListId: undefined }
    | { studyId: string; sampleId: undefined; sampleListId: string };

export interface ExtendedAlteration
    extends Mutation,
        NumericGeneMolecularData,
        StructuralVariant {
    hugoGeneSymbol: string;
    molecularProfileAlterationType: MolecularProfile['molecularAlterationType'];
    // TODO: what is difference molecularProfileAlterationType and
    // alterationType?
    alterationType: string;
    alterationSubType: string;
}

export interface AnnotatedMutation extends Mutation {
    hugoGeneSymbol: string;
    putativeDriver: boolean;
    oncoKbOncogenic: string;
    isHotspot: boolean;
    simplifiedMutationType: SimplifiedMutationType;
}

export interface AnnotatedStructuralVariant extends StructuralVariant {
    putativeDriver: boolean;
    oncoKbOncogenic: string;
    isHotspot: boolean;
    entrezGeneId: number;
    hugoGeneSymbol: string;
}

export interface CustomDriverNumericGeneMolecularData
    extends NumericGeneMolecularData {
    driverFilter: string;
    driverFilterAnnotation: string;
    driverTiersFilter: string;
    driverTiersFilterAnnotation: string;
}

export interface AnnotatedNumericGeneMolecularData
    extends CustomDriverNumericGeneMolecularData {
    hugoGeneSymbol: string;
    oncoKbOncogenic: string;
    putativeDriver: boolean;
}

export interface AnnotatedExtendedAlteration
    extends ExtendedAlteration,
        AnnotatedMutation,
        AnnotatedStructuralVariant,
        AnnotatedNumericGeneMolecularData {}

export interface ExtendedSample extends Sample {
    cancerType: string;
    cancerTypeDetailed: string;
}

export type CaseAggregatedData<T> = {
    samples: { [uniqueSampleKey: string]: T[] };
    patients: { [uniquePatientKey: string]: T[] };
};

/*
 * OQL-queried data by patient and sample, along with the query metadata and,
 * if specified in the type argument, a non-aggregated copy of the data
 */
export interface IQueriedCaseData<DataInOQL> {
    cases: CaseAggregatedData<AnnotatedExtendedAlteration>;
    oql: OQLLineFilterOutput<DataInOQL>;
}

/*
 * OQL-queried data by patient and sample, along with the query metadata and a
 * non-aggregated copy of the data and, in case of a merged track, an array of
 * records per individual gene queried
 */
export interface IQueriedMergedTrackCaseData {
    cases: CaseAggregatedData<AnnotatedExtendedAlteration>;
    oql: UnflattenedOQLLineFilterOutput<AnnotatedExtendedAlteration>;
    mergedTrackOqlList?: IQueriedCaseData<object>[];
}

export type GeneticEntity = {
    geneticEntityName: string; // hugo gene symbol for gene, gene set name for geneset
    geneticEntityType: GeneticEntityType;
    geneticEntityId: string | number; //entrezGeneId (number) for "gene", genesetId (string) for "geneset"
    cytoband: string; //will be "" for "geneset"
    geneticEntityData: Gene | Geneset;
};

export function buildDefaultOQLProfile(
    profilesTypes: string[],
    zScoreThreshold: number,
    rppaScoreThreshold: number
) {
    var default_oql_uniq: any = {};
    for (var i = 0; i < profilesTypes.length; i++) {
        var type = profilesTypes[i];
        switch (type) {
            case AlterationTypeConstants.MUTATION_EXTENDED:
                default_oql_uniq['MUT'] = true;
                break;
            case AlterationTypeConstants.COPY_NUMBER_ALTERATION:
                default_oql_uniq['AMP'] = true;
                default_oql_uniq['HOMDEL'] = true;
                break;
            case AlterationTypeConstants.MRNA_EXPRESSION:
                default_oql_uniq['EXP>=' + zScoreThreshold] = true;
                default_oql_uniq['EXP<=-' + zScoreThreshold] = true;
                break;
            case AlterationTypeConstants.PROTEIN_LEVEL:
                default_oql_uniq['PROT>=' + rppaScoreThreshold] = true;
                default_oql_uniq['PROT<=-' + rppaScoreThreshold] = true;
                break;
            case AlterationTypeConstants.STRUCTURAL_VARIANT:
                default_oql_uniq['FUSION'] = true;
                break;
        }
    }
    return Object.keys(default_oql_uniq).join(' ');
}

export function extendSamplesWithCancerType(
    samples: Sample[],
    clinicalDataForSamples: ClinicalData[],
    studies: CancerStudy[]
) {
    const clinicalDataGroupedBySampleId = _.groupBy(
        clinicalDataForSamples,
        (clinicalData: ClinicalData) => clinicalData.uniqueSampleKey
    );
    // note that this table is actually mutating underlying sample.  it's not worth it to clone samples just
    // for purity
    const extendedSamples = samples.map((sample: ExtendedSample) => {
        const clinicalData =
            clinicalDataGroupedBySampleId[sample.uniqueSampleKey];
        if (clinicalData) {
            clinicalData.forEach((clinicalDatum: ClinicalData) => {
                switch (clinicalDatum.clinicalAttributeId) {
                    case CLINICAL_ATTRIBUTE_ID_ENUM.CANCER_TYPE_DETAILED:
                        sample.cancerTypeDetailed = clinicalDatum.value;
                        break;
                    case CLINICAL_ATTRIBUTE_ID_ENUM.CANCER_TYPE:
                        sample.cancerType = clinicalDatum.value;
                        break;
                    default:
                        break;
                }
            });
        }
        return sample;
    });

    //make a map by studyId for easy access in following loop
    const studyMap = _.keyBy(studies, (study: CancerStudy) => study.studyId);

    // now we need to fix any samples which do not have both cancerType and cancerTypeDetailed
    extendedSamples.forEach((sample: ExtendedSample) => {
        //if we have no cancer subtype, then make the subtype the parent type
        if (!sample.cancerType) {
            // we need to fall back to studies cancerType
            const study = studyMap[sample.studyId];
            if (study) {
                sample.cancerType = study.cancerType.name;
            } else {
                sample.cancerType = SAMPLE_CANCER_TYPE_UNKNOWN;
            }
        }
        if (sample.cancerType && !sample.cancerTypeDetailed) {
            sample.cancerTypeDetailed = sample.cancerType;
        }
    });

    return extendedSamples;
}

export type DriverAnnotationSettings = {
    excludeVUS: boolean;
    cbioportalCount: boolean;
    cbioportalCountThreshold: number;
    cosmicCount: boolean;
    cosmicCountThreshold: number;
    customBinary: boolean;
    customTiersDefault: boolean;
    driverTiers: ObservableMap<string, boolean>;
    hotspots: boolean;
    oncoKb: boolean;
    driversAnnotated: boolean;
};

export type ModifyQueryParams = {
    selectedSampleListId: string;
    selectedSampleIds: string[];
    caseIdsMode: 'sample' | 'patient';
};

/* fields and methods in the class below are ordered based on roughly
/* chronological setup concerns, rather than on encapsulation and public API */
/* tslint:disable: member-ordering */
export class ResultsViewPageStore {
    constructor(private appStore: AppStore, urlWrapper: ResultsViewURLWrapper) {
        makeObservable(this);
        //labelMobxPromises(this);

        this.urlWrapper = urlWrapper;

        // addErrorHandler((error: any) => {
        //     this.ajaxErrors.push(error);
        // });
        this.getURL();

        const store = this;

        this.driverAnnotationSettings = observable({
            cbioportalCount: false,
            cbioportalCountThreshold: 0,
            cosmicCount: false,
            cosmicCountThreshold: 0,
            driverTiers: observable.map<string, boolean>(),

            _hotspots: false,
            _oncoKb: false,
            _excludeVUS: false,
            _customBinary: undefined,

            set hotspots(val: boolean) {
                this._hotspots = val;
            },
            get hotspots() {
                return (
                    !!AppConfig.serverConfig.show_hotspot &&
                    this._hotspots &&
                    !store.didHotspotFailInOncoprint
                );
            },
            set oncoKb(val: boolean) {
                this._oncoKb = val;
            },
            get oncoKb() {
                return (
                    AppConfig.serverConfig.show_oncokb &&
                    this._oncoKb &&
                    !store.didOncoKbFailInOncoprint
                );
            },
            set excludeVUS(val: boolean) {
                this._excludeVUS = val;
            },
            get excludeVUS() {
                return this._excludeVUS && this.driversAnnotated;
            },
            get driversAnnotated() {
                const anyCustomDriverTiersSelected = Array.from(
                    this.driverTiers.entries()
                ).reduce(
                    (oneSelected: boolean, nextEntry: [string, boolean]) => {
                        return oneSelected || nextEntry[1];
                    },
                    false
                );

                const anySelected =
                    this.oncoKb ||
                    this.hotspots ||
                    this.cbioportalCount ||
                    this.cosmicCount ||
                    this.customBinary ||
                    anyCustomDriverTiersSelected;

                return anySelected;
            },

            set customBinary(val: boolean) {
                this._customBinary = val;
            },
            get customBinary() {
                return this._customBinary === undefined
                    ? AppConfig.serverConfig
                          .oncoprint_custom_driver_annotation_binary_default
                    : this._customBinary;
            },
            get customTiersDefault() {
                return AppConfig.serverConfig
                    .oncoprint_custom_driver_annotation_tiers_default;
            },
        });

        this.driverAnnotationsReactionDisposer = reaction(
            () => this.urlWrapper.query.cancer_study_list,
            () => {
                this.initDriverAnnotationSettings();
            },
            { fireImmediately: true }
        );
    }

    destroy() {
        this.driverAnnotationsReactionDisposer();
    }

    public urlWrapper: ResultsViewURLWrapper;

    public driverAnnotationsReactionDisposer: any;

    // Use gene + driver as key, e.g. TP53_DRIVER or TP53_NO_DRIVER
    private mutationMapperStoreByGeneWithDriverKey: {
        [hugoGeneSymbolWithDriver: string]: ResultsViewMutationMapperStore;
    } = {};

    @computed get oqlText() {
        return this.urlWrapper.query.gene_list;
    }

    @computed get genesetIds() {
        return this.urlWrapper.query.geneset_list &&
            this.urlWrapper.query.geneset_list.trim().length
            ? this.urlWrapper.query.geneset_list.trim().split(/\s+/)
            : [];
    }

    @computed get selectedGenericAssayEntitiesGroupByMolecularProfileId() {
        return parseGenericAssayGroups(
            this.urlWrapper.query.generic_assay_groups
        );
    }

    @computed
    get cancerStudyIds() {
        return this.urlWrapper.query.cancer_study_list.split(',');
    }

    @computed
    get rppaScoreThreshold() {
        return this.urlWrapper.query.RPPA_SCORE_THRESHOLD
            ? parseFloat(this.urlWrapper.query.RPPA_SCORE_THRESHOLD)
            : DEFAULT_RPPA_THRESHOLD;
    }

    @computed
    get zScoreThreshold() {
        return this.urlWrapper.query.Z_SCORE_THRESHOLD
            ? parseFloat(this.urlWrapper.query.Z_SCORE_THRESHOLD)
            : DEFAULT_Z_SCORE_THRESHOLD;
    }

    @computed
    get selectedMolecularProfileIds() {
        //use profileFilter when both profileFilter and MolecularProfileIds are present in query
        if (isNaN(parseInt(this.urlWrapper.query.profileFilter, 10))) {
            return [];
        }
        return getMolecularProfiles(this.urlWrapper.query);
    }

    public handleTabChange(id: string, replace?: boolean) {
        this.urlWrapper.updateURL({}, `results/${id}`, false, replace);
    }

    @computed get tabId() {
        return this.urlWrapper.tabId || ResultsViewTab.ONCOPRINT;
    }

    @observable public resultsPageSettingsVisible = false;

    @observable public checkingVirtualStudies = false;

    @observable public urlValidationError: string | null = null;

    @computed get profileFilter() {
        return this.urlWrapper.query.profileFilter || '0';
    }

    @observable ajaxErrors: Error[] = [];

    @observable public sessionIdURL = '';

    @observable queryFormVisible: boolean = false;

    @computed get doNonSelectedDownloadableMolecularProfilesExist() {
        return (
            this.nonSelectedDownloadableMolecularProfilesGroupByName.result &&
            _.keys(
                this.nonSelectedDownloadableMolecularProfilesGroupByName.result
            ).length > 0
        );
    }

    @observable public modifyQueryParams:
        | ModifyQueryParams
        | undefined = undefined;

    public driverAnnotationSettings: DriverAnnotationSettings;

    @action.bound
    public setOncoprintAnalysisCaseType(e: OncoprintAnalysisCaseType) {
        this.urlWrapper.updateURL({
            show_samples: (e === OncoprintAnalysisCaseType.SAMPLE).toString(),
        } as Partial<CancerStudyQueryUrlParams>);
    }

    @computed
    public get excludeGermlineMutations() {
        return this.urlWrapper.query.exclude_germline_mutations === 'true';
    }

    @action.bound
    public setExcludeGermlineMutations(e: boolean) {
        this.urlWrapper.updateURL({
            exclude_germline_mutations: e.toString(),
        });
    }

    @computed
    public get usePatientLevelEnrichments() {
        return this.urlWrapper.query.patient_enrichments === 'true';
    }

    @action.bound
    public setUsePatientLevelEnrichments(e: boolean) {
        this.urlWrapper.updateURL({ patient_enrichments: e.toString() });
    }

    @computed
    public get hideUnprofiledSamples() {
        return this.urlWrapper.query.hide_unprofiled_samples === 'true';
    }

    @action.bound
    public setHideUnprofiledSamples(e: boolean) {
        this.urlWrapper.updateURL({
            hide_unprofiled_samples: e.toString(),
        });
    }

    @computed get hugoGeneSymbols() {
        if (this.urlWrapper.query.gene_list.length > 0) {
            return uniqueGenesInOQLQuery(this.urlWrapper.query.gene_list);
        } else {
            return [];
        }
    }

    @computed get queryContainsOql() {
        return doesQueryContainOQL(this.urlWrapper.query.gene_list);
    }

    @computed get queryContainsMutationOql() {
        return doesQueryContainMutationOQL(this.urlWrapper.query.gene_list);
    }

    @computed get sampleListCategory(): SampleListCategoryType | undefined {
        if (
            this.urlWrapper.query.case_set_id &&
            [
                SampleListCategoryType.w_mut,
                SampleListCategoryType.w_cna,
                SampleListCategoryType.w_mut_cna,
            ].includes(this.urlWrapper.query.case_set_id as any)
        ) {
            return this.urlWrapper.query.case_set_id as SampleListCategoryType;
        } else {
            return undefined;
        }
    }

    public initDriverAnnotationSettings() {
        this.driverAnnotationSettings.cbioportalCount = false;
        this.driverAnnotationSettings.cbioportalCountThreshold = 10;
        this.driverAnnotationSettings.cosmicCount = false;
        this.driverAnnotationSettings.cosmicCountThreshold = 10;
        this.driverAnnotationSettings.driverTiers = observable.map<
            string,
            boolean
        >();
        (this.driverAnnotationSettings as any)._oncoKb = !!AppConfig
            .serverConfig.oncoprint_oncokb_default;
        this.driverAnnotationSettings.hotspots = !!AppConfig.serverConfig
            .oncoprint_hotspots_default;
        (this.driverAnnotationSettings as any)._excludeVUS = !!AppConfig
            .serverConfig.oncoprint_hide_vus_default;
    }

    private makeMutationsTabFilteringSettings() {
        const self = this;
        let _excludeVus = observable.box<boolean | undefined>(undefined);
        let _excludeGermline = observable.box<boolean | undefined>(undefined);
        return observable({
            useOql: true,
            get excludeVus() {
                if (_excludeVus.get() === undefined) {
                    return self.driverAnnotationSettings.excludeVUS;
                } else {
                    return _excludeVus.get()!;
                }
            },
            get excludeGermline() {
                if (_excludeGermline.get() === undefined) {
                    return self.excludeGermlineMutations;
                } else {
                    return _excludeGermline.get()!;
                }
            },
            set excludeVus(s: boolean) {
                _excludeVus.set(s);
            },
            set excludeGermline(s: boolean) {
                _excludeGermline.set(s);
            },
        });
    }

    private getURL() {
        const shareURL = window.location.href;

        if (!shareURL.includes('session_id')) return;

        const showSamples = shareURL.indexOf('&show');
        if (showSamples > -1) {
            this.sessionIdURL = shareURL.slice(0, showSamples);
        }
    }

    readonly selectedMolecularProfiles = remoteData<MolecularProfile[]>({
        await: () => [
            this.studyToMolecularProfiles,
            this.studies,
            this.molecularProfileIdToMolecularProfile,
        ],
        invoke: () => {
            // if there are multiple studies or if there are no selected molecular profiles in query
            // derive default profiles based on profileFilter (refers to old data priority)
            if (
                this.studies.result.length > 1 ||
                this.selectedMolecularProfileIds.length === 0
            ) {
                return Promise.resolve(
                    getDefaultMolecularProfiles(
                        this.studyToMolecularProfiles.result!,
                        this.profileFilter
                    )
                );
            } else {
                // if we have only one study, then consult the selectedMolecularProfileIds because
                // user can directly select set
                const idLookupMap = _.keyBy(
                    this.selectedMolecularProfileIds,
                    (id: string) => id
                ); // optimization

                const hasMutationProfileInQuery = _.some(
                    this.selectedMolecularProfileIds,
                    molecularProfileId => {
                        const molecularProfile = this
                            .molecularProfileIdToMolecularProfile.result[
                            molecularProfileId
                        ];
                        return (
                            molecularProfile !== undefined &&
                            molecularProfile.molecularAlterationType ===
                                AlterationTypeConstants.MUTATION_EXTENDED
                        );
                    }
                );

                if (hasMutationProfileInQuery) {
                    const structuralVariantProfile = _.find(
                        this.molecularProfilesInStudies.result!,
                        molecularProfile => {
                            return (
                                molecularProfile.molecularAlterationType ===
                                AlterationTypeConstants.STRUCTURAL_VARIANT
                            );
                        }
                    );
                    if (structuralVariantProfile) {
                        idLookupMap[
                            structuralVariantProfile.molecularProfileId
                        ] = structuralVariantProfile.molecularProfileId;
                    }
                }
                return Promise.resolve(
                    this.molecularProfilesInStudies.result!.filter(
                        (profile: MolecularProfile) =>
                            profile.molecularProfileId in idLookupMap
                    )
                );
            }
        },
    });

    readonly clinicalAttributes_profiledIn = remoteData<
        (ClinicalAttribute & { molecularProfileIds: string[] })[]
    >({
        await: () => [
            this.coverageInformation,
            this.molecularProfileIdToMolecularProfile,
            this.selectedMolecularProfiles,
            this.studyIds,
        ],
        invoke: () => {
            return Promise.resolve(
                makeProfiledInClinicalAttributes(
                    this.coverageInformation.result!.samples,
                    this.molecularProfileIdToMolecularProfile.result!,
                    this.selectedMolecularProfiles.result!,
                    this.studyIds.result!.length === 1
                )
            );
        },
    });

    @computed.struct get comparisonGroupsReferencedInURL() {
        const clinicalTracksParam = this.urlWrapper.query.clinicallist;
        if (clinicalTracksParam) {
            const groupIds = clinicalTracksParam
                .split(',') // split by comma
                .filter((clinicalAttributeId: string) =>
                    clinicalAttributeIsINCOMPARISONGROUP({
                        clinicalAttributeId,
                    })
                ) // filter for comparison group tracks
                .map((clinicalAttributeId: string) =>
                    convertComparisonGroupClinicalAttribute(
                        clinicalAttributeId,
                        false
                    )
                ); // convert track ids to group ids
            return groupIds;
        } else {
            return [];
        }
    }

    readonly savedComparisonGroupsForStudies = remoteData<Group[]>({
        await: () => [this.queriedStudies],
        invoke: async () => {
            let ret: Group[] = [];
            if (this.appStore.isLoggedIn) {
                try {
                    ret = ret.concat(
                        await comparisonClient.getGroupsForStudies(
                            this.queriedStudies.result!.map(x => x.studyId)
                        )
                    );
                } catch (e) {
                    // fail silently
                }
            }
            // add any groups that are referenced in URL
            for (const id of this.comparisonGroupsReferencedInURL) {
                try {
                    ret.push(await comparisonClient.getGroup(id));
                } catch (e) {
                    // ignore any errors with group ids that don't exist
                }
            }
            return ret;
        },
    });

    readonly queryDerivedGroups = remoteData<SessionGroupData[]>({
        await: () => [
            this.studyIds,
            this.filteredAlteredSamples,
            this.filteredUnalteredSamples,
            this.filteredAlteredPatients,
            this.filteredUnalteredPatients,
            this.filteredSamples,
            this.oqlFilteredCaseAggregatedDataByUnflattenedOQLLine,
            this.defaultOQLQuery,
        ],
        invoke: () => {
            const groups: SessionGroupData[] = [];

            // altered/unaltered groups
            groups.push(
                ...getAlteredVsUnalteredGroups(
                    this.usePatientLevelEnrichments,
                    this.studyIds.result!,
                    this.filteredAlteredSamples.result!,
                    this.filteredUnalteredSamples.result!,
                    this.queryContainsOql
                )
            );

            // altered per oncoprint track groups
            groups.push(
                ...getAlteredByOncoprintTrackGroups(
                    this.usePatientLevelEnrichments,
                    this.studyIds.result!,
                    this.filteredSamples.result!,
                    this.oqlFilteredCaseAggregatedDataByUnflattenedOQLLine
                        .result!,
                    this.defaultOQLQuery.result!
                )
            );
            return Promise.resolve(groups);
        },
    });

    readonly comparisonTabComparisonSession = remoteData<Session>({
        await: () => [this.studyIds],
        invoke: () => {
            const sessionId = this.urlWrapper.query
                .comparison_createdGroupsSessionId;

            if (sessionId) {
                // if theres a session holding onto user-created groups, add groups from there
                return comparisonClient.getComparisonSession(sessionId);
            } else {
                return Promise.resolve({
                    id: '',
                    groups: [],
                    origin: this.studyIds.result!,
                });
            }
        },
    });
    readonly comparisonTabGroups = remoteData<ResultsViewComparisonGroup[]>({
        await: () => [
            this.queryDerivedGroups,
            this.comparisonTabComparisonSession,
            this.sampleMap,
        ],
        invoke: () => {
            const uniqueColorGetter = makeUniqueColorGetter([
                ALTERED_COLOR,
                UNALTERED_COLOR,
            ]);
            const groups = this.queryDerivedGroups.result!.concat(
                this.comparisonTabComparisonSession.result!.groups
            );
            const defaultOrderGroups = completeSessionGroups(
                this.usePatientLevelEnrichments,
                groups,
                this.sampleMap.result!,
                uniqueColorGetter
            );
            return Promise.resolve(defaultOrderGroups);
        },
    });

    readonly clinicalAttributes_comparisonGroupMembership = remoteData<
        (ClinicalAttribute & { comparisonGroup: Group })[]
    >({
        await: () => [this.savedComparisonGroupsForStudies],
        invoke: () =>
            Promise.resolve(
                makeComparisonGroupClinicalAttributes(
                    this.savedComparisonGroupsForStudies.result!
                )
            ),
    });

    readonly selectedMolecularProfileIdsByAlterationType = remoteData<{
        [alterationType: string]: MolecularProfile[];
    }>({
        await: () => [this.selectedMolecularProfiles],
        invoke: () => {
            const profiles: MolecularProfile[] = this.selectedMolecularProfiles
                .result!;
            return Promise.resolve(
                _.groupBy(
                    profiles,
                    GENETIC_PROFILE_FIELD_ENUM.MOLECULAR_ALTERATION_TYPE
                )
            );
        },
    });

    readonly clinicalAttributes = remoteData<ExtendedClinicalAttribute[]>({
        await: () => [
            this.studyIds,
            this.clinicalAttributes_profiledIn,
            this.clinicalAttributes_comparisonGroupMembership,
            this.clinicalAttributes_customCharts,
            this.samples,
            this.patients,
        ],
        invoke: async () => {
            const serverAttributes = await client.fetchClinicalAttributesUsingPOST(
                {
                    studyIds: this.studyIds.result!,
                }
            );
            const specialAttributes = [
                {
                    clinicalAttributeId: SpecialAttribute.MutationSpectrum,
                    datatype: CLINICAL_ATTRIBUTE_FIELD_ENUM.DATATYPE_COUNTS_MAP,
                    description:
                        'Number of point mutations in the sample counted by different types of nucleotide changes.',
                    displayName: 'Mutation spectrum',
                    patientAttribute: false,
                    studyId: '',
                    priority: '0', // TODO: change?
                } as ClinicalAttribute,
            ];
            if (this.studyIds.result!.length > 1) {
                // if more than one study, add "Study of Origin" attribute
                specialAttributes.push({
                    clinicalAttributeId: SpecialAttribute.StudyOfOrigin,
                    datatype: CLINICAL_ATTRIBUTE_FIELD_ENUM.DATATYPE_STRING,
                    description: 'Study which the sample is a part of.',
                    displayName: 'Study of origin',
                    patientAttribute: false,
                    studyId: '',
                    priority: '0', // TODO: change?
                } as ClinicalAttribute);
            }
            if (this.samples.result!.length !== this.patients.result!.length) {
                // if different number of samples and patients, add "Num Samples of Patient" attribute
                specialAttributes.push({
                    clinicalAttributeId: SpecialAttribute.NumSamplesPerPatient,
                    datatype: CLINICAL_ATTRIBUTE_FIELD_ENUM.DATATYPE_NUMBER,
                    description: 'Number of queried samples for each patient.',
                    displayName: '# Samples per Patient',
                    patientAttribute: true,
                } as ClinicalAttribute);
            }
            return [
                ...serverAttributes,
                ...specialAttributes,
                ...this.clinicalAttributes_profiledIn.result!,
                ...this.clinicalAttributes_comparisonGroupMembership.result!,
                ...this.clinicalAttributes_customCharts.result!,
            ];
        },
    });

    readonly clinicalAttributeIdToClinicalAttribute = remoteData({
        await: () => [this.clinicalAttributes],
        invoke: () =>
            Promise.resolve(
                _.keyBy(
                    this.clinicalAttributes.result!,
                    CLINICAL_ATTRIBUTE_FIELD_ENUM.ID
                )
            ),
    });

    readonly clinicalAttributeIdToAvailableSampleCount = remoteData({
        await: () => [
            this.samples,
            this.sampleMap,
            this.studies,
            this.clinicalAttributes,
            this.studyToDataQueryFilter,
            this.clinicalAttributes_profiledIn,
            this.clinicalAttributes_comparisonGroupMembership,
            this.clinicalAttributes_customCharts,
        ],
        invoke: async () => {
            let clinicalAttributeCountFilter: ClinicalAttributeCountFilter;
            if (this.studies.result.length === 1) {
                // try using sample list id
                const studyId = this.studies.result![0].studyId;
                const dqf = this.studyToDataQueryFilter.result[studyId];
                if (dqf.sampleListId) {
                    clinicalAttributeCountFilter = {
                        sampleListId: dqf.sampleListId,
                    } as ClinicalAttributeCountFilter;
                } else {
                    clinicalAttributeCountFilter = {
                        sampleIdentifiers: dqf.sampleIds!.map(sampleId => ({
                            sampleId,
                            studyId,
                        })),
                    } as ClinicalAttributeCountFilter;
                }
            } else {
                // use sample identifiers
                clinicalAttributeCountFilter = {
                    sampleIdentifiers: this.samples.result!.map(sample => ({
                        sampleId: sample.sampleId,
                        studyId: sample.studyId,
                    })),
                } as ClinicalAttributeCountFilter;
            }

            const result = await internalClient.getClinicalAttributeCountsUsingPOST(
                {
                    clinicalAttributeCountFilter,
                }
            );
            // build map
            const ret: { [clinicalAttributeId: string]: number } = _.reduce(
                result,
                (
                    map: { [clinicalAttributeId: string]: number },
                    next: ClinicalAttributeCount
                ) => {
                    map[next.clinicalAttributeId] =
                        map[next.clinicalAttributeId] || 0;
                    map[next.clinicalAttributeId] += next.count;
                    return map;
                },
                {}
            );
            // add count = 0 for any remaining clinical attributes, since service doesnt return count 0
            for (const clinicalAttribute of this.clinicalAttributes.result!) {
                if (!(clinicalAttribute.clinicalAttributeId in ret)) {
                    ret[clinicalAttribute.clinicalAttributeId] = 0;
                }
            }
            // add counts for "special" clinical attributes
            ret[
                SpecialAttribute.NumSamplesPerPatient
            ] = this.samples.result!.length;
            ret[SpecialAttribute.StudyOfOrigin] = this.samples.result!.length;
            let samplesWithMutationData = 0,
                samplesWithCNAData = 0;
            for (const sample of this.samples.result!) {
                samplesWithMutationData += +!!sample.sequenced;
                samplesWithCNAData += +!!sample.copyNumberSegmentPresent;
            }
            ret[SpecialAttribute.MutationSpectrum] = samplesWithMutationData;
            // add counts for "ProfiledIn" clinical attributes
            for (const attr of this.clinicalAttributes_profiledIn.result!) {
                ret[attr.clinicalAttributeId] = this.samples.result!.length;
            }
            // add counts for "ComparisonGroup" clinical attributes
            const sampleMap = this.sampleMap.result!;
            for (const attr of this.clinicalAttributes_comparisonGroupMembership
                .result!) {
                ret[attr.clinicalAttributeId] = getNumSamples(
                    attr.comparisonGroup!.data,
                    (studyId, sampleId) => {
                        return sampleMap.has({ studyId, sampleId });
                    }
                );
            }
            // add counts for custom chart clinical attributes
            for (const attr of this.clinicalAttributes_customCharts.result!) {
                ret[attr.clinicalAttributeId] = attr.data!.filter(
                    d => d.value !== 'NA'
                ).length;
            }
            return ret;
        },
    });

    readonly cnSegments = remoteData<CopyNumberSeg[]>(
        {
            await: () => [this.filteredSamples],
            invoke: () =>
                fetchCopyNumberSegmentsForSamples(this.filteredSamples.result!),
        },
        []
    );

    readonly cnSegmentsByChromosome = remoteData<{
        [chromosome: string]: MobxPromise<CopyNumberSeg[]>;
    }>(
        {
            await: () => [
                this.genes,
                this.filteredSamples,
                this.referenceGenes,
            ],
            invoke: () => {
                const uniqueReferenceGeneChromosomes = _.uniq(
                    this.referenceGenes.result!.map(g => g.chromosome)
                );
                return Promise.resolve(
                    uniqueReferenceGeneChromosomes.reduce(
                        (
                            map: {
                                [chromosome: string]: MobxPromise<
                                    CopyNumberSeg[]
                                >;
                            },
                            chromosome: string
                        ) => {
                            map[chromosome] = remoteData<CopyNumberSeg[]>({
                                invoke: () =>
                                    fetchCopyNumberSegmentsForSamples(
                                        this.filteredSamples.result!,
                                        chromosome
                                    ),
                            });
                            return map;
                        },
                        {}
                    )
                );
            },
        },
        {}
    );

    readonly molecularData = remoteData<NumericGeneMolecularData[]>({
        await: () => [
            this.studyToDataQueryFilter,
            this.genes,
            this.selectedMolecularProfiles,
            this.samples,
        ],
        invoke: () => {
            // we get mutations with mutations endpoint, structural variants and fusions with structural variant endpoint, generic assay with generic assay endpoint.
            // filter out mutation genetic profile and structural variant profiles and generic assay profiles
            const profilesWithoutMutationProfile = excludeSpecialMolecularProfiles(
                this.selectedMolecularProfiles.result!
            );
            const genes = this.genes.result;

            if (
                profilesWithoutMutationProfile.length &&
                genes != undefined &&
                genes.length
            ) {
                const identifiers: SampleMolecularIdentifier[] = [];

                profilesWithoutMutationProfile.forEach(
                    (profile: MolecularProfile) => {
                        // for each profile, find samples which share studyId with profile and add identifier
                        this.samples.result.forEach((sample: Sample) => {
                            if (sample.studyId === profile.studyId) {
                                identifiers.push({
                                    molecularProfileId:
                                        profile.molecularProfileId,
                                    sampleId: sample.sampleId,
                                });
                            }
                        });
                    }
                );

                if (identifiers.length) {
                    return client.fetchMolecularDataInMultipleMolecularProfilesUsingPOST(
                        {
                            projection: REQUEST_ARG_ENUM.PROJECTION_DETAILED,
                            molecularDataMultipleStudyFilter: {
                                entrezGeneIds: _.map(
                                    this.genes.result,
                                    (gene: Gene) => gene.entrezGeneId
                                ),
                                sampleMolecularIdentifiers: identifiers,
                            } as MolecularDataMultipleStudyFilter,
                        }
                    );
                }
            }

            return Promise.resolve([]);
        },
    });

    // Isolate discrete CNA data from other NumericMolecularData
    // and add the custom driver annotations to data points
    readonly discreteCNAMolecularData = remoteData<
        CustomDriverNumericGeneMolecularData[]
    >({
        await: () => [this.discreteCopyNumberAlterations, this.molecularData],
        invoke: () => {
            const cnaData = _.filter(
                this.molecularData.result as any,
                (d: any) => {
                    return _.includes(
                        this.cnaMolecularProfileIds,
                        d.molecularProfileId
                    );
                }
            );
            _.forEach(cnaData, (d: any) => {
                // Lookup the DiscreteCopyNumberData datum that
                // holds the custom driver annotation.
                const discreteCopyNumberDatumKey = createDiscreteCopyNumberDataKey(
                    d
                );
                const discreteCopyNumberDatum =
                    discreteCopyNumberDatumKey in
                    this.sampleIdAndEntrezIdToDiscreteCopyNumberData
                        ? this.sampleIdAndEntrezIdToDiscreteCopyNumberData[
                              discreteCopyNumberDatumKey
                          ]
                        : undefined;

                d.driverFilter = discreteCopyNumberDatum
                    ? discreteCopyNumberDatum.driverFilter
                    : '';
                d.driverFilterAnnotation = discreteCopyNumberDatum
                    ? discreteCopyNumberDatum.driverFilterAnnotation
                    : '';
                d.driverTiersFilter = discreteCopyNumberDatum
                    ? discreteCopyNumberDatum.driverTiersFilter
                    : '';
                d.driverTiersFilterAnnotation = discreteCopyNumberDatum
                    ? discreteCopyNumberDatum.driverTiersFilterAnnotation
                    : '';
            });
            return Promise.resolve(
                cnaData as CustomDriverNumericGeneMolecularData[]
            );
        },
    });

    // other molecular profiles data download needs the data from non queried molecular profiles
    readonly nonSelectedDownloadableMolecularData = remoteData<
        NumericGeneMolecularData[]
    >({
        await: () => [
            this.genes,
            this.nonSelectedDownloadableMolecularProfiles,
            this.samples,
        ],
        invoke: () => {
            // we get mutations with mutations endpoint, structural variants and fusions with structural variant endpoint.
            // filter out mutation genetic profile and structural variant profiles
            const profilesWithoutMutationProfile = excludeSpecialMolecularProfiles(
                this.nonSelectedDownloadableMolecularProfiles.result
            );
            const genes = this.genes.result;

            if (
                profilesWithoutMutationProfile.length &&
                genes != undefined &&
                genes.length
            ) {
                const profilesWithoutMutationProfileGroupByStudyId = _.groupBy(
                    profilesWithoutMutationProfile,
                    profile => profile.studyId
                );
                // find samples which share studyId with profile and add identifier
                const sampleIdentifiers: SampleMolecularIdentifier[] = this.samples.result
                    .filter(
                        sample =>
                            sample.studyId in
                            profilesWithoutMutationProfileGroupByStudyId
                    )
                    .reduce((acc: SampleMolecularIdentifier[], sample) => {
                        acc = acc.concat(
                            profilesWithoutMutationProfileGroupByStudyId[
                                sample.studyId
                            ].map(profile => {
                                return {
                                    molecularProfileId:
                                        profile.molecularProfileId,
                                    sampleId: sample.sampleId,
                                } as SampleMolecularIdentifier;
                            })
                        );
                        return acc;
                    }, []);

                if (sampleIdentifiers.length) {
                    return client.fetchMolecularDataInMultipleMolecularProfilesUsingPOST(
                        {
                            projection: REQUEST_ARG_ENUM.PROJECTION_DETAILED,
                            molecularDataMultipleStudyFilter: {
                                entrezGeneIds: _.map(
                                    this.genes.result,
                                    (gene: Gene) => gene.entrezGeneId
                                ),
                                sampleMolecularIdentifiers: sampleIdentifiers,
                            } as MolecularDataMultipleStudyFilter,
                        }
                    );
                }
            }

            return Promise.resolve([]);
        },
    });

    readonly coexpressionTabMolecularProfiles = remoteData<MolecularProfile[]>({
        await: () => [this.molecularProfilesInStudies],
        invoke: () =>
            Promise.resolve(
                sortRnaSeqProfilesToTop(
                    filterAndSortProfiles(
                        this.molecularProfilesInStudies.result!
                    ).concat(
                        getGenesetProfiles(
                            this.molecularProfilesInStudies.result!
                        )
                    )
                )
            ),
    });

    readonly isThereDataForCoExpressionTab = remoteData<boolean>({
        await: () => [
            this.molecularProfilesInStudies,
            this.genes,
            this.samples,
        ],
        invoke: () => {
            const coExpressionProfiles = filterAndSortProfiles(
                this.molecularProfilesInStudies.result!
            );
            const studyToProfiles = _.groupBy(
                coExpressionProfiles,
                GENETIC_PROFILE_FIELD_ENUM.STUDY_ID
            );
            // we know these are all mrna and protein profiles
            const sampleMolecularIdentifiers = _.flatten(
                this.samples.result!.map(s => {
                    const profiles = studyToProfiles[s.studyId];
                    if (profiles) {
                        return profiles.map(p => ({
                            molecularProfileId: p.molecularProfileId,
                            sampleId: s.sampleId,
                        }));
                    } else {
                        return [];
                    }
                })
            );
            const entrezGeneIds = this.genes.result!.map(g => g.entrezGeneId);
            if (
                sampleMolecularIdentifiers.length > 0 &&
                entrezGeneIds.length > 0
            ) {
                return client
                    .fetchMolecularDataInMultipleMolecularProfilesUsingPOSTWithHttpInfo(
                        {
                            molecularDataMultipleStudyFilter: {
                                entrezGeneIds,
                                sampleMolecularIdentifiers,
                            } as MolecularDataMultipleStudyFilter,
                            projection: REQUEST_ARG_ENUM.PROJECTION_META,
                        }
                    )
                    .then(function(response: request.Response) {
                        const count = parseInt(
                            response.header['total-count'],
                            10
                        );
                        return count > 0;
                    });
            } else {
                return Promise.resolve(false);
            }
        },
    });

    // remoteNgchmUrl queries mdanderson.org to test if there are NGCHMs for one selected
    // study.  The result is either the full URL to a portal page, or an empty string.
    readonly remoteNgchmUrl = remoteData<string>({
        await: () => [this.studyIds],
        invoke: async () => {
            var result = '';

            if (this.studyIds.result!.length === 1) {
                const queryData = {
                    studyid: this.studyIds.result![0],
                    format: 'json',
                };

                var urlResponse;

                try {
                    urlResponse = (await request
                        .get('https://bioinformatics.mdanderson.org/study2url')
                        .timeout(30000)
                        .query(queryData)) as any;
                } catch (err) {
                    // Just eat the exception. Result will be empty string.
                }

                if (urlResponse && urlResponse.body.fileContent) {
                    const parsedUrlResponse = JSON.parse(
                        urlResponse.body.fileContent.trimEnd()
                    ) as any;

                    if (parsedUrlResponse.length >= 1) {
                        // This is faked out for now.  study2url needs mods to include site url
                        result =
                            'https://bioinformatics.mdanderson.org/TCGA/NGCHMPortal?' +
                            parsedUrlResponse[0];
                    }
                }
            }

            return Promise.resolve(result);
        },
    });

    readonly molecularProfilesWithData = remoteData<MolecularProfile[]>({
        await: () => [
            this.molecularProfilesInStudies,
            this.studyToDataQueryFilter,
            this.genes,
            this.genesets,
        ],
        invoke: async () => {
            const ret: MolecularProfile[] = [];
            const promises = [];
            const studyToDataQueryFilter = this.studyToDataQueryFilter.result!;
            for (const profile of this.molecularProfilesInStudies.result!) {
                const dataQueryFilter = studyToDataQueryFilter[profile.studyId];

                // there could be no samples if a study doesn't have a sample list matching a specified category (e.g. cna only)
                // skip when sampleIds is an empty list
                if (
                    !dataQueryFilter ||
                    (_.isEmpty(dataQueryFilter.sampleIds) &&
                        !dataQueryFilter.sampleListId)
                ) {
                    continue;
                }

                const molecularProfileId = profile.molecularProfileId;
                const projection = REQUEST_ARG_ENUM.PROJECTION_META;
                const dataFilter = {
                    entrezGeneIds: this.genes.result!.map(g => g.entrezGeneId),
                    ...dataQueryFilter,
                } as MolecularDataFilter & MutationFilter;

                if (
                    profile.molecularAlterationType ===
                    AlterationTypeConstants.MUTATION_EXTENDED
                ) {
                    // handle mutation profile
                    promises.push(
                        client
                            .fetchMutationsInMolecularProfileUsingPOSTWithHttpInfo(
                                {
                                    molecularProfileId,
                                    mutationFilter: dataFilter,
                                    projection,
                                }
                            )
                            .then(function(response: request.Response) {
                                const count = parseInt(
                                    response.header['sample-count'],
                                    10
                                );
                                if (count > 0) {
                                    // theres data for at least one of the query genes
                                    ret.push(profile);
                                }
                            })
                    );
                } else if (
                    profile.molecularAlterationType ===
                    AlterationTypeConstants.MUTATION_UNCALLED
                ) {
                    // exclude the MUTATION_UNCALLED profile, this profile should only be used in patient view
                } else if (
                    profile.molecularAlterationType ===
                        AlterationTypeConstants.GENESET_SCORE ||
                    profile.molecularAlterationType ===
                        AlterationTypeConstants.GENERIC_ASSAY ||
                    profile.molecularAlterationType ===
                        AlterationTypeConstants.STRUCTURAL_VARIANT
                ) {
                    // geneset profile, we dont have the META projection for geneset data, so just add it
                    /*promises.push(internalClient.fetchGeneticDataItemsUsingPOST({
                        geneticProfileId: molecularProfileId,
                        genesetDataFilterCriteria: {
                            genesetIds: this.genesets.result!.map(g=>g.genesetId),
                            ...dataQueryFilter
                        } as GenesetDataFilterCriteria,
                        projection
                    }).then(function(response: request.Response) {
                        const count = parseInt(response.header["total-count"], 10);
                        if (count > 0) {
                            // theres data for at least one of the query genes
                            ret.push(profile);
                        }
                    }));*/
                    ret.push(profile);
                } else {
                    // handle non-mutation profile
                    promises.push(
                        client
                            .fetchAllMolecularDataInMolecularProfileUsingPOSTWithHttpInfo(
                                {
                                    molecularProfileId,
                                    molecularDataFilter: dataFilter,
                                    projection,
                                }
                            )
                            .then(function(response: request.Response) {
                                const count = parseInt(
                                    response.header['total-count'],
                                    10
                                );
                                if (count > 0) {
                                    // theres data for at least one of the query genes
                                    ret.push(profile);
                                }
                            })
                    );
                }
            }
            await Promise.all(promises);
            return ret;
        },
    });

    readonly nonOqlFilteredAlterations = remoteData<ExtendedAlteration[]>({
        await: () => [
            this.filteredAndAnnotatedMutations,
            this.filteredAndAnnotatedMolecularData,
            this.filteredAndAnnotatedStructuralVariants,
            this.selectedMolecularProfiles,
            this.entrezGeneIdToGene,
        ],
        invoke: () => {
            const accessors = new AccessorsForOqlFilter(
                this.selectedMolecularProfiles.result!
            );
            const entrezGeneIdToGene = this.entrezGeneIdToGene.result!;
            let result = [
                ...this.filteredAndAnnotatedMutations.result!,
                ...this.filteredAndAnnotatedMolecularData.result!,
                ...this.filteredAndAnnotatedStructuralVariants.result!,
            ];
            return Promise.resolve(
                result.map(d => {
                    const extendedD: ExtendedAlteration = annotateAlterationTypes(
                        d,
                        accessors
                    );
                    extendedD.hugoGeneSymbol =
                        entrezGeneIdToGene[d.entrezGeneId].hugoGeneSymbol;
                    extendedD.molecularProfileAlterationType = accessors.molecularAlterationType(
                        d.molecularProfileId
                    );
                    return extendedD;
                })
            );
        },
    });

    readonly oqlFilteredMutationsReport = remoteData({
        await: () => [
            this._filteredAndAnnotatedMutationsReport,
            this.selectedMolecularProfiles,
            this.defaultOQLQuery,
        ],
        invoke: () => {
            return Promise.resolve(
                _.mapValues(
                    this._filteredAndAnnotatedMutationsReport.result!,
                    data =>
                        filterCBioPortalWebServiceData(
                            this.oqlText,
                            data,
                            new AccessorsForOqlFilter(
                                this.selectedMolecularProfiles.result!
                            ),
                            this.defaultOQLQuery.result!
                        )
                )
            );
        },
    });

    readonly oqlFilteredStructuralVariantsReport = remoteData({
        await: () => [
            this._filteredAndAnnotatedStructuralVariantsReport,
            this.selectedMolecularProfiles,
            this.defaultOQLQuery,
        ],
        invoke: () => {
            return Promise.resolve(
                _.mapValues(
                    this._filteredAndAnnotatedStructuralVariantsReport.result!,
                    data =>
                        filterCBioPortalWebServiceData(
                            this.oqlText,
                            data,
                            new AccessorsForOqlFilter(
                                this.selectedMolecularProfiles.result!
                            ),
                            this.defaultOQLQuery.result!
                        )
                )
            );
        },
    });

    readonly oqlFilteredMolecularDataReport = remoteData({
        await: () => [
            this._filteredAndAnnotatedMolecularDataReport,
            this.selectedMolecularProfiles,
            this.defaultOQLQuery,
        ],
        invoke: () => {
            return Promise.resolve(
                _.mapValues(
                    this._filteredAndAnnotatedMolecularDataReport.result!,
                    data =>
                        filterCBioPortalWebServiceData(
                            this.oqlText,
                            data,
                            new AccessorsForOqlFilter(
                                this.selectedMolecularProfiles.result!
                            ),
                            this.defaultOQLQuery.result!
                        )
                )
            );
        },
    });

    readonly oqlFilteredAlterations = remoteData<ExtendedAlteration[]>({
        await: () => [
            this.filteredAndAnnotatedMutations,
            this.filteredAndAnnotatedMolecularData,
            this.filteredAndAnnotatedStructuralVariants,
            this.selectedMolecularProfiles,
            this.defaultOQLQuery,
        ],
        invoke: () => {
            if (this.oqlText.trim() != '') {
                let data: (
                    | AnnotatedMutation
                    | AnnotatedNumericGeneMolecularData
                )[] = [];
                data = data.concat(this.filteredAndAnnotatedMutations.result!);
                data = data.concat(
                    this.filteredAndAnnotatedMolecularData.result!
                );
                return Promise.resolve(
                    filterCBioPortalWebServiceData(
                        this.oqlText,
                        [
                            ...this.filteredAndAnnotatedMutations.result!,
                            ...this.filteredAndAnnotatedMolecularData.result!,
                            ...this.filteredAndAnnotatedStructuralVariants
                                .result!,
                        ],
                        new AccessorsForOqlFilter(
                            this.selectedMolecularProfiles.result!
                        ),
                        this.defaultOQLQuery.result!
                    )
                );
            } else {
                return Promise.resolve([]);
            }
        },
    });

    readonly oqlFilteredCaseAggregatedData = remoteData<
        CaseAggregatedData<ExtendedAlteration>
    >({
        await: () => [this.oqlFilteredAlterations, this.samples, this.patients],
        invoke: () => {
            return Promise.resolve({
                samples: groupBy(
                    this.oqlFilteredAlterations.result!,
                    alteration => alteration.uniqueSampleKey,
                    this.samples.result!.map(sample => sample.uniqueSampleKey)
                ),
                patients: groupBy(
                    this.oqlFilteredAlterations.result!,
                    alteration => alteration.uniquePatientKey,
                    this.patients.result!.map(sample => sample.uniquePatientKey)
                ),
            });
        },
    });

    readonly nonOqlFilteredCaseAggregatedData = remoteData<
        CaseAggregatedData<ExtendedAlteration>
    >({
        await: () => [
            this.nonOqlFilteredAlterations,
            this.samples,
            this.patients,
        ],
        invoke: () => {
            return Promise.resolve({
                samples: groupBy(
                    this.nonOqlFilteredAlterations.result!,
                    alteration => alteration.uniqueSampleKey,
                    this.samples.result!.map(sample => sample.uniqueSampleKey)
                ),
                patients: groupBy(
                    this.nonOqlFilteredAlterations.result!,
                    alteration => alteration.uniquePatientKey,
                    this.patients.result!.map(sample => sample.uniquePatientKey)
                ),
            });
        },
    });

    readonly oqlFilteredCaseAggregatedDataByUnflattenedOQLLine = remoteData<
        IQueriedMergedTrackCaseData[]
    >({
        await: () => [
            this.filteredAndAnnotatedMutations,
            this.filteredAndAnnotatedMolecularData,
            this.filteredAndAnnotatedStructuralVariants,
            this.selectedMolecularProfiles,
            this.defaultOQLQuery,
            this.samples,
            this.patients,
        ],
        invoke: () => {
            const data = [
                ...this.filteredAndAnnotatedMutations.result!,
                ...this.filteredAndAnnotatedMolecularData.result!,
                ...this.filteredAndAnnotatedStructuralVariants.result!,
            ];
            const accessorsInstance = new AccessorsForOqlFilter(
                this.selectedMolecularProfiles.result!
            );
            const defaultOQLQuery = this.defaultOQLQuery.result!;
            const samples = this.samples.result!;
            const patients = this.patients.result!;

            if (this.oqlText.trim() === '') {
                return Promise.resolve([]);
            } else {
                const filteredAlterationsByOQLLine: UnflattenedOQLLineFilterOutput<
                    AnnotatedExtendedAlteration
                >[] = filterCBioPortalWebServiceDataByUnflattenedOQLLine(
                    this.oqlText,
                    data,
                    accessorsInstance,
                    defaultOQLQuery
                );

                return Promise.resolve(
                    filteredAlterationsByOQLLine.map(oqlLine => ({
                        cases: groupDataByCase(oqlLine, samples, patients),
                        oql: oqlLine,
                        mergedTrackOqlList: filterSubQueryData(
                            oqlLine,
                            defaultOQLQuery,
                            data,
                            accessorsInstance,
                            samples,
                            patients
                        ),
                    }))
                );
            }
        },
    });

    readonly isSampleAlteredMap = remoteData({
        await: () => [
            this.oqlFilteredCaseAggregatedDataByUnflattenedOQLLine,
            this.filteredSamples,
            this.coverageInformation,
            this.selectedMolecularProfiles,
            this.studyToMolecularProfiles,
            this.defaultOQLQueryAlterations,
        ],
        invoke: async () => {
            return getSampleAlteredMap(
                this.oqlFilteredCaseAggregatedDataByUnflattenedOQLLine.result!,
                this.filteredSamples.result!,
                this.oqlText,
                this.coverageInformation.result,
                this.selectedMolecularProfiles.result!.map(
                    profile => profile.molecularProfileId
                ),
                this.studyToMolecularProfiles.result!,
                this.defaultOQLQueryAlterations.result!
            );
        },
    });

    readonly oqlFilteredCaseAggregatedDataByOQLLine = remoteData<
        IQueriedCaseData<AnnotatedExtendedAlteration>[]
    >({
        await: () => [
            this.filteredAndAnnotatedMutations,
            this.filteredAndAnnotatedMolecularData,
            this.filteredAndAnnotatedStructuralVariants,
            this.selectedMolecularProfiles,
            this.defaultOQLQuery,
            this.samples,
            this.patients,
        ],
        invoke: () => {
            if (this.oqlText.trim() === '') {
                return Promise.resolve([]);
            } else {
                const filteredAlterationsByOQLLine: OQLLineFilterOutput<
                    AnnotatedExtendedAlteration
                >[] = filterCBioPortalWebServiceDataByOQLLine(
                    this.oqlText,
                    [
                        ...this.filteredAndAnnotatedMutations.result!,
                        ...this.filteredAndAnnotatedMolecularData.result!,
                        ...this.filteredAndAnnotatedStructuralVariants.result!,
                    ],
                    new AccessorsForOqlFilter(
                        this.selectedMolecularProfiles.result!
                    ),
                    this.defaultOQLQuery.result!
                );

                return Promise.resolve(
                    filteredAlterationsByOQLLine.map(oql => ({
                        cases: groupDataByCase(
                            oql,
                            this.samples.result!,
                            this.patients.result!
                        ),
                        oql,
                    }))
                );
            }
        },
    });

    readonly studyToMolecularProfiles = remoteData({
        await: () => [this.molecularProfilesInStudies],
        invoke: () => {
            return Promise.resolve(
                _.groupBy(
                    this.molecularProfilesInStudies.result!,
                    profile => profile.studyId
                )
            );
        },
    });

    readonly coverageInformation = remoteData<CoverageInformation>(
        {
            await: () => [
                this.studyToMolecularProfiles,
                this.genes,
                this.samples,
                this.patients,
            ],
            invoke: () =>
                getCoverageInformation(
                    this.samples,
                    this.genes,
                    // const studyToMolecularProfiles = _.groupBy(this.studyToMolecularProfiles.result!, profile=>profile.studyId);
                    sample =>
                        this.studyToMolecularProfiles.result![sample.studyId],
                    () => this.patients.result!
                ),
        },
        { samples: {}, patients: {} }
    );

    readonly filteredSequencedSampleKeysByGene = remoteData<{
        [hugoGeneSymbol: string]: string[];
    }>({
        await: () => [
            this.filteredSamples,
            this.genes,
            this.coverageInformation,
            this.selectedMolecularProfiles,
        ],
        invoke: () => {
            const genePanelInformation = this.coverageInformation.result!;
            const profileIds = this.selectedMolecularProfiles.result!.map(
                p => p.molecularProfileId
            );
            return Promise.resolve(
                this.genes.result!.reduce(
                    (
                        map: { [hugoGeneSymbol: string]: string[] },
                        next: Gene
                    ) => {
                        map[next.hugoGeneSymbol] = this.filteredSamples
                            .result!.map(s => s.uniqueSampleKey)
                            .filter(k => {
                                return _.some(
                                    isSampleProfiledInMultiple(
                                        k,
                                        profileIds,
                                        genePanelInformation,
                                        next.hugoGeneSymbol
                                    )
                                );
                            });
                        return map;
                    },
                    {}
                )
            );
        },
    });

    readonly filteredSequencedPatientKeysByGene = remoteData<{
        [hugoGeneSymbol: string]: string[];
    }>({
        await: () => [
            this.sampleKeyToSample,
            this.filteredSequencedSampleKeysByGene,
        ],
        invoke: async () => {
            const sampleKeyToSample = this.sampleKeyToSample.result!;
            return _.mapValues(
                this.filteredSequencedSampleKeysByGene.result!,
                sampleKeys => {
                    return _.chain(sampleKeys)
                        .map(k => sampleKeyToSample[k].uniquePatientKey)
                        .uniq()
                        .value();
                }
            );
        },
    });

    readonly filteredAlteredSampleKeys = remoteData({
        await: () => [this.filteredSamples, this.oqlFilteredCaseAggregatedData],
        invoke: () => {
            const caseAggregatedData = this.oqlFilteredCaseAggregatedData
                .result!.samples;
            return Promise.resolve(
                this.filteredSamples
                    .result!.map(s => s.uniqueSampleKey)
                    .filter(sampleKey => {
                        return caseAggregatedData[sampleKey].length > 0;
                    })
            );
        },
    });

    readonly filteredAlteredSamples = remoteData<Sample[]>(
        {
            await: () => [
                this.sampleKeyToSample,
                this.filteredAlteredSampleKeys,
            ],
            invoke: () => {
                return Promise.resolve(
                    this.filteredAlteredSampleKeys.result!.map(
                        a => this.sampleKeyToSample.result![a]
                    )
                );
            },
        },
        []
    );

    readonly filteredAlteredPatients = remoteData({
        await: () => [
            this.filteredPatients,
            this.oqlFilteredCaseAggregatedData,
        ],
        invoke: () => {
            const caseAggregatedData = this.oqlFilteredCaseAggregatedData
                .result!;
            return Promise.resolve(
                this.filteredPatients.result!.filter(
                    patient =>
                        !!caseAggregatedData.patients[patient.uniquePatientKey]
                            .length
                )
            );
        },
    });

    readonly filteredAlteredPatientKeys = remoteData({
        await: () => [this.filteredAlteredPatients],
        invoke: () =>
            Promise.resolve(
                this.filteredAlteredPatients.result!.map(
                    p => p.uniquePatientKey
                )
            ),
    });

    readonly filteredUnalteredSampleKeys = remoteData({
        await: () => [this.filteredSamples, this.oqlFilteredCaseAggregatedData],
        invoke: () => {
            const caseAggregatedData = this.oqlFilteredCaseAggregatedData
                .result!;
            return Promise.resolve(
                this.filteredSamples
                    .result!.map(s => s.uniqueSampleKey)
                    .filter(
                        sampleKey =>
                            !caseAggregatedData.samples[sampleKey].length
                    )
            );
        },
    });

    readonly filteredUnalteredSamples = remoteData<Sample[]>(
        {
            await: () => [
                this.sampleKeyToSample,
                this.filteredUnalteredSampleKeys,
            ],
            invoke: () => {
                const unalteredSamples: Sample[] = [];
                this.filteredUnalteredSampleKeys.result!.forEach(a =>
                    unalteredSamples.push(this.sampleKeyToSample.result![a])
                );
                return Promise.resolve(unalteredSamples);
            },
        },
        []
    );

    readonly filteredUnalteredPatients = remoteData({
        await: () => [
            this.filteredPatients,
            this.oqlFilteredCaseAggregatedData,
        ],
        invoke: () => {
            const caseAggregatedData = this.oqlFilteredCaseAggregatedData
                .result!;
            return Promise.resolve(
                this.filteredPatients.result!.filter(
                    patient =>
                        !caseAggregatedData.patients[patient.uniquePatientKey]
                            .length
                )
            );
        },
    });

    readonly oqlFilteredAlterationsByGene = remoteData<{
        [hugoGeneSymbol: string]: ExtendedAlteration[];
    }>({
        await: () => [this.genes, this.oqlFilteredAlterations],
        invoke: () => {
            // first group them by gene symbol
            const groupedGenesMap = _.groupBy(
                this.oqlFilteredAlterations.result!,
                alteration => alteration.hugoGeneSymbol
            );
            // kind of ugly but this fixes a bug where sort order of genes not respected
            // yes we are relying on add order of js map. in theory not guaranteed, in practice guaranteed
            const ret = this.genes.result!.reduce(
                (
                    memo: { [hugoGeneSymbol: string]: ExtendedAlteration[] },
                    gene: Gene
                ) => {
                    memo[gene.hugoGeneSymbol] =
                        groupedGenesMap[gene.hugoGeneSymbol];
                    return memo;
                },
                {}
            );

            return Promise.resolve(ret);
        },
    });

    readonly defaultOQLQuery = remoteData({
        await: () => [this.selectedMolecularProfiles],
        invoke: () => {
            const profileTypes = _.uniq(
                _.map(
                    this.selectedMolecularProfiles.result,
                    profile => profile.molecularAlterationType
                )
            );
            return Promise.resolve(
                buildDefaultOQLProfile(
                    profileTypes,
                    this.zScoreThreshold,
                    this.rppaScoreThreshold
                )
            );
        },
    });

    readonly defaultOQLQueryAlterations = remoteData<Alteration[] | false>({
        await: () => [this.defaultOQLQuery],
        invoke: () => {
            if (this.defaultOQLQuery.result) {
                return Promise.resolve(
                    (oql_parser.parse(
                        `DUMMYGENE: ${this.defaultOQLQuery.result!}`
                    )![0] as SingleGeneQuery).alterations
                );
            } else {
                return Promise.resolve(false);
            }
        },
    });

    readonly survivalClinicalAttributesPrefix = remoteData({
        await: () => [this.clinicalAttributes],
        invoke: () => {
            return Promise.resolve(
                getSurvivalClinicalAttributesPrefix(
                    this.clinicalAttributes.result!
                )
            );
        },
    });

    readonly survivalClinicalDataExists = remoteData<boolean>({
        await: () => [this.samples, this.survivalClinicalAttributesPrefix],
        invoke: () =>
            fetchSurvivalDataExists(
                this.samples.result!,
                this.survivalClinicalAttributesPrefix.result!
            ),
    });

    readonly filteredSamplesByDetailedCancerType = remoteData<{
        [cancerType: string]: Sample[];
    }>({
        await: () => [this.filteredSamples, this.clinicalDataForSamples],
        invoke: () => {
            let groupedSamples = this.groupSamplesByCancerType(
                this.clinicalDataForSamples.result,
                this.filteredSamples.result!,
                'CANCER_TYPE'
            );
            if (_.size(groupedSamples) === 1) {
                groupedSamples = this.groupSamplesByCancerType(
                    this.clinicalDataForSamples.result,
                    this.filteredSamples.result!,
                    'CANCER_TYPE_DETAILED'
                );
            }
            return Promise.resolve(groupedSamples);
        },
    });

    readonly filteredSamplesExtendedWithClinicalData = remoteData<
        ExtendedSample[]
    >({
        await: () => [
            this.filteredSamples,
            this.clinicalDataForSamples,
            this.studies,
        ],
        invoke: () => {
            return Promise.resolve(
                extendSamplesWithCancerType(
                    this.filteredSamples.result!,
                    this.clinicalDataForSamples.result,
                    this.studies.result
                )
            );
        },
    });

    public groupSamplesByCancerType(
        clinicalDataForSamples: ClinicalData[],
        samples: Sample[],
        cancerTypeLevel: 'CANCER_TYPE' | 'CANCER_TYPE_DETAILED'
    ) {
        // first generate map of sampleId to it's cancer type
        const sampleKeyToCancerTypeClinicalDataMap = _.reduce(
            clinicalDataForSamples,
            (memo, clinicalData: ClinicalData) => {
                if (clinicalData.clinicalAttributeId === cancerTypeLevel) {
                    memo[clinicalData.uniqueSampleKey] = clinicalData.value;
                }

                // if we were told CANCER_TYPE and we find CANCER_TYPE_DETAILED, then fall back on it. if we encounter
                // a CANCER_TYPE later, it will override this.
                if (cancerTypeLevel === 'CANCER_TYPE') {
                    if (
                        !memo[clinicalData.uniqueSampleKey] &&
                        clinicalData.clinicalAttributeId ===
                            'CANCER_TYPE_DETAILED'
                    ) {
                        memo[clinicalData.uniqueSampleKey] = clinicalData.value;
                    }
                }

                return memo;
            },
            {} as { [uniqueSampleId: string]: string }
        );

        // now group samples by cancer type
        let samplesGroupedByCancerType = _.reduce(
            samples,
            (memo: { [cancerType: string]: Sample[] }, sample: Sample) => {
                // if it appears in map, then we have a cancer type
                if (
                    sample.uniqueSampleKey in
                    sampleKeyToCancerTypeClinicalDataMap
                ) {
                    memo[
                        sampleKeyToCancerTypeClinicalDataMap[
                            sample.uniqueSampleKey
                        ]
                    ] =
                        memo[
                            sampleKeyToCancerTypeClinicalDataMap[
                                sample.uniqueSampleKey
                            ]
                        ] || [];
                    memo[
                        sampleKeyToCancerTypeClinicalDataMap[
                            sample.uniqueSampleKey
                        ]
                    ].push(sample);
                } else {
                    // TODO: we need to fall back to study cancer type
                }
                return memo;
            },
            {} as { [cancerType: string]: Sample[] }
        );

        return samplesGroupedByCancerType;
        //
    }

    readonly oqlFilteredAlterationsByGeneBySampleKey = remoteData<{
        [hugoGeneSymbol: string]: {
            [uniquSampleKey: string]: ExtendedAlteration[];
        };
    }>({
        await: () => [this.oqlFilteredAlterationsByGene, this.samples],
        invoke: async () => {
            return _.mapValues(
                this.oqlFilteredAlterationsByGene.result,
                (alterations: ExtendedAlteration[]) => {
                    return _.groupBy(
                        alterations,
                        (alteration: ExtendedAlteration) =>
                            alteration.uniqueSampleKey
                    );
                }
            );
        },
    });

    //contains all the physical studies for the current selected cohort ids
    //selected cohort ids can be any combination of physical_study_id and virtual_study_id(shared or saved ones)
    public get physicalStudySet(): { [studyId: string]: CancerStudy } {
        return _.keyBy(
            this.studies.result,
            (study: CancerStudy) => study.studyId
        );
    }

    // used in building virtual study
    readonly studyWithSamples = remoteData<StudyWithSamples[]>({
        await: () => [
            this.samples,
            this.queriedStudies,
            this.queriedVirtualStudies,
        ],
        invoke: () => {
            return Promise.resolve(
                getFilteredStudiesWithSamples(
                    this.samples.result,
                    this.queriedStudies.result,
                    this.queriedVirtualStudies.result
                )
            );
        },
        onError: error => {},
        default: [],
    });

    readonly mutationProfiles = remoteData({
        await: () => [this.selectedMolecularProfiles],
        invoke: async () => {
            return this.selectedMolecularProfiles.result!.filter(
                profile =>
                    profile.molecularAlterationType ===
                    AlterationTypeConstants.MUTATION_EXTENDED
            );
        },
        onError: error => {},
        default: [],
    });

    readonly cnaProfiles = remoteData({
        await: () => [this.selectedMolecularProfiles],
        invoke: async () => {
            return this.selectedMolecularProfiles.result!.filter(
                profile =>
                    profile.molecularAlterationType ===
                        AlterationTypeConstants.COPY_NUMBER_ALTERATION &&
                    profile.datatype === DataTypeConstants.DISCRETE
            );
        },
        onError: error => {},
        default: [],
    });

    readonly structuralVariantProfiles = remoteData({
        await: () => [this.selectedMolecularProfiles],
        invoke: async () => {
            return this.selectedMolecularProfiles.result!.filter(
                profile =>
                    profile.molecularAlterationType ===
                    AlterationTypeConstants.STRUCTURAL_VARIANT
            );
        },
        onError: error => {},
        default: [],
    });

    readonly clinicalAttributes_customCharts = remoteData({
        await: () => [this.sampleMap],
        invoke: async () => {
            let ret: ExtendedClinicalAttribute[] = [];
            if (this.appStore.isLoggedIn) {
                try {
                    //Add custom data from user profile
                    const customChartSessions = await sessionServiceClient.getCustomDataForStudies(
                        this.cancerStudyIds
                    );

                    ret = getExtendsClinicalAttributesFromCustomData(
                        customChartSessions,
                        this.sampleMap.result!
                    );
                } catch (e) {}
            }
            return ret;
        },
    });

    @computed get cnaMolecularProfileIds() {
        const profiles = this.cnaProfiles.isComplete
            ? this.cnaProfiles.result
            : [];
        const profileIds = _.map(
            profiles,
            (p: MolecularProfile) => p.molecularProfileId
        );
        return profileIds;
    }

    @computed
    get chartMetaSet(): { [id: string]: ChartMeta } {
        let _chartMetaSet: { [id: string]: ChartMeta } = {} as {
            [id: string]: ChartMeta;
        };

        // Add meta information for each of the clinical attribute
        // Convert to a Set for easy access and to update attribute meta information(would be useful while adding new features)
        _.reduce(
            this.clinicalAttributes.result,
            (acc: { [id: string]: ChartMeta }, attribute) => {
                const uniqueKey = getUniqueKey(attribute);
                acc[uniqueKey] = {
                    displayName: attribute.displayName,
                    uniqueKey: uniqueKey,
                    dataType: getChartMetaDataType(uniqueKey),
                    patientAttribute: attribute.patientAttribute,
                    description: attribute.description,
                    priority: getPriorityByClinicalAttribute(attribute),
                    renderWhenDataChange: false,
                    clinicalAttribute: attribute,
                };
                return acc;
            },
            _chartMetaSet
        );

        if (!_.isEmpty(this.mutationProfiles.result!)) {
            const uniqueKey = getUniqueKeyFromMolecularProfileIds(
                this.mutationProfiles.result.map(
                    profile => profile.molecularProfileId
                )
            );
            _chartMetaSet[uniqueKey] = {
                uniqueKey: uniqueKey,
                dataType: ChartMetaDataTypeEnum.GENOMIC,
                patientAttribute: false,
                displayName: 'Mutated Genes',
                priority: getDefaultPriorityByUniqueKey(
                    ChartTypeEnum.MUTATED_GENES_TABLE
                ),
                renderWhenDataChange: false,
                description: '',
            };
        }

        if (!_.isEmpty(this.cnaProfiles.result)) {
            const uniqueKey = getUniqueKeyFromMolecularProfileIds(
                this.cnaProfiles.result.map(
                    profile => profile.molecularProfileId
                )
            );
            _chartMetaSet[uniqueKey] = {
                uniqueKey: uniqueKey,
                dataType: ChartMetaDataTypeEnum.GENOMIC,
                patientAttribute: false,
                displayName: 'CNA Genes',
                renderWhenDataChange: false,
                priority: getDefaultPriorityByUniqueKey(
                    ChartTypeEnum.CNA_GENES_TABLE
                ),
                description: '',
            };
        }

        const scatterRequiredParams = _.reduce(
            this.clinicalAttributes.result,
            (acc, next) => {
                if (
                    SpecialChartsUniqueKeyEnum.MUTATION_COUNT ===
                    next.clinicalAttributeId
                ) {
                    acc[SpecialChartsUniqueKeyEnum.MUTATION_COUNT] = true;
                }
                if (
                    SpecialChartsUniqueKeyEnum.FRACTION_GENOME_ALTERED ===
                    next.clinicalAttributeId
                ) {
                    acc[
                        SpecialChartsUniqueKeyEnum.FRACTION_GENOME_ALTERED
                    ] = true;
                }
                return acc;
            },
            {
                [SpecialChartsUniqueKeyEnum.MUTATION_COUNT]: false,
                [SpecialChartsUniqueKeyEnum.FRACTION_GENOME_ALTERED]: false,
            }
        );

        if (
            scatterRequiredParams[SpecialChartsUniqueKeyEnum.MUTATION_COUNT] &&
            scatterRequiredParams[
                SpecialChartsUniqueKeyEnum.FRACTION_GENOME_ALTERED
            ]
        ) {
            _chartMetaSet[
                SpecialChartsUniqueKeyEnum.MUTATION_COUNT_CNA_FRACTION
            ] = {
                dataType: ChartMetaDataTypeEnum.GENOMIC,
                patientAttribute: false,
                uniqueKey:
                    SpecialChartsUniqueKeyEnum.MUTATION_COUNT_CNA_FRACTION,
                displayName: 'Mutation Count vs Fraction of Genome Altered',
                priority: getDefaultPriorityByUniqueKey(
                    SpecialChartsUniqueKeyEnum.MUTATION_COUNT_CNA_FRACTION
                ),
                renderWhenDataChange: false,
                description: '',
            };
        }
        return _chartMetaSet;
    }

    readonly virtualStudyParams = remoteData<IVirtualStudyProps>({
        await: () => [
            this.samples,
            this.studyIds,
            this.studyWithSamples,
            this.queriedVirtualStudies,
        ],
        invoke: () =>
            Promise.resolve({
                user: this.appStore.userName,
                name:
                    this.queriedVirtualStudies.result.length === 1
                        ? this.queriedVirtualStudies.result[0].data.name
                        : undefined,
                description:
                    this.queriedVirtualStudies.result.length === 1
                        ? this.queriedVirtualStudies.result[0].data.description
                        : undefined,
                studyWithSamples: this.studyWithSamples.result,
                selectedSamples: this.samples.result,
                filter: { studyIds: this.studyIds.result },
                attributesMetaSet: this.chartMetaSet,
            } as IVirtualStudyProps),
    });

    readonly givenSampleOrder = remoteData<Sample[]>({
        await: () => [this.samples, this.samplesSpecification],
        invoke: async () => {
            // for now, just assume we won't mix sample lists and samples in the specification
            if (this.samplesSpecification.result!.find(x => !x.sampleId)) {
                // for now, if theres any sample list id specification, then there is no given sample order
                return [];
            }
            // at this point, we know samplesSpecification is a list of samples
            const studyToSampleToIndex: {
                [studyId: string]: { [sampleId: string]: number };
            } = _.reduce(
                this.samplesSpecification.result,
                (
                    map: { [studyId: string]: { [sampleId: string]: number } },
                    next: SamplesSpecificationElement,
                    index: number
                ) => {
                    map[next.studyId] = map[next.studyId] || {};
                    map[next.studyId][next.sampleId!] = index; // we know sampleId defined otherwise we would have returned from function already
                    return map;
                },
                {}
            );
            return _.sortBy(
                this.samples.result,
                sample => studyToSampleToIndex[sample.studyId][sample.sampleId]
            );
        },
    });

    readonly studyToSampleIds = remoteData<{
        [studyId: string]: { [sampleId: string]: boolean };
    }>(
        {
            await: () => [this.samplesSpecification],
            invoke: async () => {
                const sampleListsToQuery: {
                    studyId: string;
                    sampleListId: string;
                }[] = [];
                const ret: {
                    [studyId: string]: { [sampleId: string]: boolean };
                } = {};
                for (const sampleSpec of this.samplesSpecification.result!) {
                    if (sampleSpec.sampleId) {
                        // add sample id to study
                        ret[sampleSpec.studyId] = ret[sampleSpec.studyId] || {};
                        ret[sampleSpec.studyId][sampleSpec.sampleId] = true;
                    } else if (sampleSpec.sampleListId) {
                        // mark sample list to query later
                        sampleListsToQuery.push(
                            sampleSpec as {
                                studyId: string;
                                sampleListId: string;
                            }
                        );
                    }
                }
                // query for sample lists
                if (sampleListsToQuery.length > 0) {
                    const sampleLists: SampleList[] = await client.fetchSampleListsUsingPOST(
                        {
                            sampleListIds: sampleListsToQuery.map(
                                spec => spec.sampleListId
                            ),
                            projection: REQUEST_ARG_ENUM.PROJECTION_DETAILED,
                        }
                    );
                    // add samples from those sample lists to corresponding study
                    for (const sampleList of sampleLists) {
                        ret[sampleList.studyId] = stringListToSet(
                            sampleList.sampleIds
                        );
                    }
                }
                return ret;
            },
        },
        {}
    );

    readonly studyToSampleListId = remoteData<{ [studyId: string]: string }>({
        await: () => [this.samplesSpecification],
        invoke: async () => {
            return this.samplesSpecification.result!.reduce((map, next) => {
                if (next.sampleListId) {
                    map[next.studyId] = next.sampleListId;
                }
                return map;
            }, {} as { [studyId: string]: string });
        },
    });

    @computed get samplesSpecificationParams() {
        return parseSamplesSpecifications(
            this.urlWrapper.query.case_ids,
            this.urlWrapper.query.sample_list_ids,
            this.urlWrapper.query.case_set_id,
            this.cancerStudyIds
        );
    }

    readonly samplesSpecification = remoteData({
        await: () => [this.queriedVirtualStudies],
        invoke: async () => {
            // is this a sample list category query?
            // if YES, we need to derive the sample lists by:
            // 1. looking up all sample lists in selected studies
            // 2. using those with matching category
            if (!this.sampleListCategory) {
                if (this.queriedVirtualStudies.result!.length > 0) {
                    return populateSampleSpecificationsFromVirtualStudies(
                        this.samplesSpecificationParams,
                        this.queriedVirtualStudies.result!
                    );
                } else {
                    return this.samplesSpecificationParams;
                }
            } else {
                // would be nice to have an endpoint that would return multiple sample lists
                // but this will only ever happen one for each study selected (and in queries where a sample list is specified)
                let samplesSpecifications = [];
                // get sample specifications from physical studies if we are querying virtual study
                if (this.queriedVirtualStudies.result!.length > 0) {
                    samplesSpecifications = populateSampleSpecificationsFromVirtualStudies(
                        this.samplesSpecificationParams,
                        this.queriedVirtualStudies.result!
                    );
                } else {
                    samplesSpecifications = this.samplesSpecificationParams;
                }
                // get unique study ids to reduce the API requests
                const uniqueStudyIds = _.chain(samplesSpecifications)
                    .map(specification => specification.studyId)
                    .uniq()
                    .value();
                const allSampleLists = await Promise.all(
                    uniqueStudyIds.map(studyId => {
                        return client.getAllSampleListsInStudyUsingGET({
                            studyId: studyId,
                            projection: REQUEST_ARG_ENUM.PROJECTION_SUMMARY,
                        });
                    })
                );

                const category =
                    SampleListCategoryTypeToFullId[this.sampleListCategory!];
                const specs = allSampleLists.reduce(
                    (
                        aggregator: SamplesSpecificationElement[],
                        sampleLists
                    ) => {
                        //find the sample list matching the selected category using the map from shortname to full category name :(
                        const matchingList = _.find(
                            sampleLists,
                            list => list.category === category
                        );
                        if (matchingList) {
                            aggregator.push({
                                studyId: matchingList.studyId,
                                sampleListId: matchingList.sampleListId,
                                sampleId: undefined,
                            } as SamplesSpecificationElement);
                        }
                        return aggregator;
                    },
                    []
                );

                return specs;
            }
        },
    });

    readonly studyToMutationMolecularProfile = remoteData<{
        [studyId: string]: MolecularProfile;
    }>(
        {
            await: () => [this.mutationProfiles],
            invoke: () => {
                return Promise.resolve(
                    _.keyBy(
                        this.mutationProfiles.result,
                        (profile: MolecularProfile) => profile.studyId
                    )
                );
            },
        },
        {}
    );

    readonly allStudies = remoteData(
        {
            invoke: async () =>
                await client.getAllStudiesUsingGET({
                    projection: REQUEST_ARG_ENUM.PROJECTION_SUMMARY,
                }),
        },
        []
    );

    readonly everyStudyIdToStudy = remoteData({
        await: () => [this.allStudies],
        invoke: () =>
            Promise.resolve(_.keyBy(this.allStudies.result!, s => s.studyId)),
    });

    readonly queriedVirtualStudies = remoteData(
        {
            await: () => [this.allStudies],
            invoke: async () => {
                const allCancerStudies = this.allStudies.result;
                const cancerStudyIds = this.cancerStudyIds;

                const missingFromCancerStudies = _.differenceWith(
                    cancerStudyIds,
                    allCancerStudies,
                    (id: string, study: CancerStudy) => id === study.studyId
                );
                let ret: VirtualStudy[] = [];

                for (const missingId of missingFromCancerStudies) {
                    try {
                        const vs = await sessionServiceClient.getVirtualStudy(
                            missingId
                        );
                        ret = ret.concat(vs);
                    } catch (error) {
                        // ignore missing studies
                        continue;
                    }
                }
                return Promise.resolve(ret);
            },
            onError: () => {
                // fail silently when an error occurs with the virtual studies
            },
            // just return empty array if session service is disabled
        },
        []
    );

    readonly studyIds = remoteData(
        {
            await: () => [this.queriedVirtualStudies],
            invoke: () => {
                let physicalStudies: string[];
                if (this.queriedVirtualStudies.result!.length > 0) {
                    // we want to replace virtual studies with their underlying physical studies
                    physicalStudies = substitutePhysicalStudiesForVirtualStudies(
                        this.cancerStudyIds,
                        this.queriedVirtualStudies.result!
                    );
                } else {
                    physicalStudies = this.cancerStudyIds.slice();
                }
                return Promise.resolve(physicalStudies);
            },
        },
        []
    );

    // this is less than desirable way of validating studyIds
    // if studyId does not appear in list of all physical studies
    // we assume it's a virtual study and try to retrieve it as such
    // if there's no corresponding virtual study
    // we assume it's an invalid studyId
    readonly invalidStudyIds = remoteData(
        {
            await: () => [this.allStudies, this.queriedVirtualStudies],
            invoke: () => {
                const allCancerStudies = this.allStudies.result;
                const cancerStudyIds = this.cancerStudyIds;

                const missingFromCancerStudies = _.differenceWith(
                    cancerStudyIds,
                    allCancerStudies,
                    (id: string, study: CancerStudy) => id === study.studyId
                );

                if (
                    missingFromCancerStudies.length &&
                    this.queriedVirtualStudies.result.length === 0
                ) {
                    return Promise.resolve(missingFromCancerStudies);
                } else {
                    return Promise.resolve([]);
                }
            },
        },
        []
    );

    @computed get downloadFilenamePrefix() {
        return generateDownloadFilenamePrefixByStudies(this.studies.result);
    }

    // TODO: refactor b/c we already have sample lists summary so
    readonly sampleLists = remoteData<SampleList[]>({
        await: () => [this.studyToSampleListId],
        invoke: () => {
            const sampleListIds = _.values(this.studyToSampleListId.result!);
            if (sampleListIds.length > 0) {
                return client.fetchSampleListsUsingPOST({ sampleListIds });
            } else {
                return Promise.resolve([]);
            }
        },
    });

    readonly studyToSelectedMolecularProfilesMap = remoteData<{
        [studyId: string]: {
            [molecularAlterationType: string]: MolecularProfile;
        };
    }>({
        await: () => [this.selectedMolecularProfiles],
        invoke: () => {
            return Promise.resolve(
                _.mapValues(
                    _.groupBy(
                        this.selectedMolecularProfiles.result!,
                        p => p.studyId
                    ),
                    profiles =>
                        _.keyBy(profiles, p => p.molecularAlterationType)
                )
            );
        },
    });

    readonly discreteCopyNumberAlterations = remoteData<
        DiscreteCopyNumberData[]
    >({
        await: () => [
            this.genes,
            this.studyToMolecularProfileDiscreteCna,
            this.samples,
        ],
        invoke: async () => {
            if (this.cnaMolecularProfileIds.length == 0) {
                return [];
            }

            const entrezGeneIds = _.map(
                this.genes.result,
                (gene: Gene) => gene.entrezGeneId
            );

            const promises = _.map(
                this.cnaMolecularProfileIds,
                cnaMolecularProfileId => {
                    const sampleIds = _.map(
                        this.samples.result,
                        (sample: Sample) => {
                            if (
                                sample.studyId in
                                this.studyToMolecularProfileDiscreteCna.result
                            ) {
                                return sample.sampleId;
                            }
                        }
                    );

                    return client.fetchDiscreteCopyNumbersInMolecularProfileUsingPOST(
                        {
                            discreteCopyNumberEventType: 'HOMDEL_AND_AMP',
                            discreteCopyNumberFilter: {
                                entrezGeneIds,
                                sampleIds,
                            } as DiscreteCopyNumberFilter,
                            molecularProfileId: cnaMolecularProfileId,
                            projection: 'DETAILED',
                        }
                    );
                }
            );

            let outdata = [] as DiscreteCopyNumberData[];
            await Promise.all(promises).then((cnaData: any[]) => {
                outdata = _.flattenDeep(cnaData);
            });

            return Promise.resolve(outdata as DiscreteCopyNumberData[]);
        },
    });

    @computed get sampleIdAndEntrezIdToDiscreteCopyNumberData() {
        return _.keyBy(
            this.discreteCopyNumberAlterations.result,
            (d: DiscreteCopyNumberData) => createDiscreteCopyNumberDataKey(d)
        );
    }

    readonly mutations = remoteData<Mutation[]>({
        await: () => [
            this.genes,
            this.samples,
            this.studyToMutationMolecularProfile,
        ],
        invoke: async () => {
            if (_.isEmpty(this.studyToMutationMolecularProfile.result)) {
                return [];
            }
            const studyIdToProfileMap = this.studyToMutationMolecularProfile
                .result;

            const filters = this.samples.result.reduce(
                (memo, sample: Sample) => {
                    if (sample.studyId in studyIdToProfileMap) {
                        memo.push({
                            molecularProfileId:
                                studyIdToProfileMap[sample.studyId]
                                    .molecularProfileId,
                            sampleId: sample.sampleId,
                        });
                    }
                    return memo;
                },
                [] as any[]
            );

            const data = {
                entrezGeneIds: _.map(
                    this.genes.result,
                    (gene: Gene) => gene.entrezGeneId
                ),
                sampleMolecularIdentifiers: filters,
            } as MutationMultipleStudyFilter;

            return await client.fetchMutationsInMultipleMolecularProfilesUsingPOST(
                {
                    projection: REQUEST_ARG_ENUM.PROJECTION_DETAILED,
                    mutationMultipleStudyFilter: data,
                }
            );
        },
    });

    readonly studyToStructuralVariantMolecularProfile = remoteData<{
        [studyId: string]: MolecularProfile;
    }>(
        {
            await: () => [this.structuralVariantProfiles],
            invoke: () => {
                return Promise.resolve(
                    _.keyBy(
                        this.structuralVariantProfiles.result,
                        (profile: MolecularProfile) => profile.studyId
                    )
                );
            },
        },
        {}
    );

    readonly structuralVariants = remoteData<StructuralVariant[]>({
        await: () => [
            this.genes,
            this.samples,
            this.studyToStructuralVariantMolecularProfile,
        ],
        invoke: async () => {
            if (
                _.isEmpty(this.studyToStructuralVariantMolecularProfile.result)
            ) {
                return [];
            }
            const studyIdToProfileMap = this
                .studyToStructuralVariantMolecularProfile.result;

            const filters = this.samples.result.reduce(
                (memo, sample: Sample) => {
                    if (sample.studyId in studyIdToProfileMap) {
                        memo.push({
                            molecularProfileId:
                                studyIdToProfileMap[sample.studyId]
                                    .molecularProfileId,
                            sampleId: sample.sampleId,
                        });
                    }
                    return memo;
                },
                [] as StructuralVariantFilter['sampleMolecularIdentifiers']
            );

            const data = {
                entrezGeneIds: _.map(
                    this.genes.result,
                    (gene: Gene) => gene.entrezGeneId
                ),
                sampleMolecularIdentifiers: filters,
            } as StructuralVariantFilter;

            return await client.fetchStructuralVariantsUsingPOST({
                structuralVariantFilter: data,
            });
        },
    });

    @computed get existsSomeMutationWithAscnProperty(): {
        [property: string]: boolean;
    } {
        if (this.mutations.result === undefined) {
            return existsSomeMutationWithAscnPropertyInCollection(
                [] as Mutation[]
            );
        } else {
            return existsSomeMutationWithAscnPropertyInCollection(
                this.mutations.result
            );
        }
    }

    public mutationsTabFilteringSettings = this.makeMutationsTabFilteringSettings();

    readonly mutationsReportByGene = remoteData<{
        [hugeGeneSymbol: string]: FilteredAndAnnotatedMutationsReport;
    }>({
        await: () => [this._filteredAndAnnotatedMutationsReport, this.genes],
        invoke: () => {
            let mutationGroups: FilteredAndAnnotatedMutationsReport = this
                ._filteredAndAnnotatedMutationsReport.result!;
            const ret: {
                [hugoGeneSymbol: string]: FilteredAndAnnotatedMutationsReport;
            } = {};
            for (const gene of this.genes.result!) {
                ret[gene.hugoGeneSymbol] = {
                    data: [],
                    vus: [],
                    germline: [],
                    vusAndGermline: [],
                };
            }
            for (const mutation of mutationGroups.data) {
                ret[mutation.gene.hugoGeneSymbol].data.push(mutation);
            }
            for (const mutation of mutationGroups.vus) {
                ret[mutation.gene.hugoGeneSymbol].vus.push(mutation);
            }
            for (const mutation of mutationGroups.germline) {
                ret[mutation.gene.hugoGeneSymbol].germline.push(mutation);
            }
            for (const mutation of mutationGroups.vusAndGermline) {
                ret[mutation.gene.hugoGeneSymbol].vusAndGermline.push(mutation);
            }
            return Promise.resolve(ret);
        },
    });

    readonly structuralVariantsReportByGene = remoteData<{
        [hugeGeneSymbol: string]: FilteredAndAnnotatedStructuralVariantsReport;
    }>({
        await: () => [
            this._filteredAndAnnotatedStructuralVariantsReport,
            this.genes,
        ],
        invoke: () => {
            let structuralVariantsGroups = this
                ._filteredAndAnnotatedStructuralVariantsReport.result!;
            const ret: {
                [hugoGeneSymbol: string]: FilteredAndAnnotatedStructuralVariantsReport;
            } = {};
            for (const gene of this.genes.result!) {
                ret[gene.hugoGeneSymbol] = {
                    data: [],
                    vus: [],
                    germline: [],
                    vusAndGermline: [],
                };
            }
            for (const structuralVariant of structuralVariantsGroups.data) {
                ret[structuralVariant.site1HugoSymbol].data.push(
                    structuralVariant
                );
            }
            for (const structuralVariant of structuralVariantsGroups.vus) {
                ret[structuralVariant.site1HugoSymbol].vus.push(
                    structuralVariant
                );
            }
            for (const structuralVariant of structuralVariantsGroups.germline) {
                ret[structuralVariant.site1HugoSymbol].germline.push(
                    structuralVariant
                );
            }
            for (const structuralVariant of structuralVariantsGroups.vusAndGermline) {
                ret[structuralVariant.site1HugoSymbol].vusAndGermline.push(
                    structuralVariant
                );
            }
            return Promise.resolve(ret);
        },
    });

    readonly mutationsByGene = remoteData<{
        [hugoGeneSymbol: string]: Mutation[];
    }>({
        await: () => [
            this.selectedMolecularProfiles,
            this.defaultOQLQuery,
            this.mutationsReportByGene,
            this.filteredSampleKeyToSample,
            this.structuralVariantsReportByGene,
        ],
        invoke: () => {
            const mutationsByGene = _.mapValues(
                this.mutationsReportByGene.result!,
                (mutationGroups: FilteredAndAnnotatedMutationsReport) => {
                    if (
                        this.mutationsTabFilteringSettings.useOql &&
                        this.queryContainsMutationOql
                    ) {
                        // use oql filtering in mutations tab only if query contains mutation oql
                        mutationGroups = _.mapValues(
                            mutationGroups,
                            mutations =>
                                filterCBioPortalWebServiceData(
                                    this.oqlText,
                                    mutations,
                                    new AccessorsForOqlFilter(
                                        this.selectedMolecularProfiles.result!
                                    ),
                                    this.defaultOQLQuery.result!
                                )
                        );
                    }
                    const filteredMutations = compileMutations(
                        mutationGroups,
                        this.mutationsTabFilteringSettings.excludeVus,
                        this.mutationsTabFilteringSettings.excludeGermline
                    );
                    if (this.hideUnprofiledSamples) {
                        // filter unprofiled samples
                        const sampleMap = this.filteredSampleKeyToSample
                            .result!;
                        return filteredMutations.filter(
                            m => m.uniqueSampleKey in sampleMap
                        );
                    } else {
                        return filteredMutations;
                    }
                }
            );

            //TODO: remove once SV/Fusion tab is merged
            _.forEach(
                this.structuralVariantsReportByGene.result,
                (structuralVariantsGroups, hugoGeneSymbol) => {
                    if (mutationsByGene[hugoGeneSymbol] === undefined) {
                        mutationsByGene[hugoGeneSymbol] = [];
                    }

                    if (
                        this.mutationsTabFilteringSettings.useOql &&
                        this.queryContainsMutationOql
                    ) {
                        // use oql filtering in mutations tab only if query contains mutation oql
                        structuralVariantsGroups = _.mapValues(
                            structuralVariantsGroups,
                            structuralVariants =>
                                filterCBioPortalWebServiceData(
                                    this.oqlText,
                                    structuralVariants,
                                    new AccessorsForOqlFilter(
                                        this.selectedMolecularProfiles.result!
                                    ),
                                    this.defaultOQLQuery.result!
                                )
                        );
                    }
                    let filteredStructuralVariants = compileStructuralVariants(
                        structuralVariantsGroups,
                        this.mutationsTabFilteringSettings.excludeVus,
                        this.mutationsTabFilteringSettings.excludeGermline
                    );
                    if (this.hideUnprofiledSamples) {
                        // filter unprofiled samples
                        const sampleMap = this.filteredSampleKeyToSample
                            .result!;
                        filteredStructuralVariants = filteredStructuralVariants.filter(
                            m => m.uniqueSampleKey in sampleMap
                        );
                    }

                    filteredStructuralVariants.forEach(structuralVariant => {
                        const mutation = {
                            center: structuralVariant.center,
                            chr: structuralVariant.site1Chromosome,
                            entrezGeneId: structuralVariant.site1EntrezGeneId,
                            keyword: structuralVariant.comments,
                            molecularProfileId:
                                structuralVariant.molecularProfileId,
                            mutationType: CanonicalMutationType.FUSION,
                            ncbiBuild: structuralVariant.ncbiBuild,
                            patientId: structuralVariant.patientId,
                            proteinChange: structuralVariant.eventInfo,
                            sampleId: structuralVariant.sampleId,
                            startPosition: structuralVariant.site1Position,
                            studyId: structuralVariant.studyId,
                            uniquePatientKey:
                                structuralVariant.uniquePatientKey,
                            uniqueSampleKey: structuralVariant.uniqueSampleKey,
                            variantType: structuralVariant.variantClass,
                            gene: {
                                entrezGeneId:
                                    structuralVariant.site1EntrezGeneId,
                                hugoGeneSymbol:
                                    structuralVariant.site1HugoSymbol,
                            },
                            hugoGeneSymbol: structuralVariant.site1HugoSymbol,
                            putativeDriver: structuralVariant.putativeDriver,
                            oncoKbOncogenic: structuralVariant.oncoKbOncogenic,
                            isHotspot: structuralVariant.isHotspot,
                            simplifiedMutationType:
                                CanonicalMutationType.FUSION,
                        } as AnnotatedMutation;

                        mutationsByGene[hugoGeneSymbol].push(mutation);
                    });
                }
            );
            //TODO: remove once SV/Fusion tab is merged

            return Promise.resolve(mutationsByGene);
        },
    });

    public createMutationMapperStoreForSelectedGene(gene: Gene) {
        const store = new ResultsViewMutationMapperStore(
            AppConfig.serverConfig,
            {
                filterMutationsBySelectedTranscript: true,
                filterAppliersOverride: {
                    [ANNOTATED_PROTEIN_IMPACT_FILTER_TYPE]: createAnnotatedProteinImpactTypeFilter(
                        this.isPutativeDriver
                    ),
                },
            },
            gene,
            this.filteredSamples,
            this.oncoKbCancerGenes,
            () => this.mutationsByGene.result![gene.hugoGeneSymbol] || [],
            () => this.mutationCountCache,
            () => this.genomeNexusCache,
            () => this.genomeNexusMutationAssessorCache,
            () => this.discreteCNACache,
            this.studyToMolecularProfileDiscreteCna.result!,
            this.studyIdToStudy,
            this.molecularProfileIdToMolecularProfile,
            this.clinicalDataForSamples,
            this.studiesForSamplesWithoutCancerTypeClinicalData,
            this.germlineConsentedSamples,
            this.indexedHotspotData,
            this.indexedVariantAnnotations,
            this.uniqueSampleKeyToTumorType.result!,
            this.generateGenomeNexusHgvsgUrl,
            this.clinicalDataGroupedBySampleMap,
            this.genomeNexusClient,
            this.genomeNexusInternalClient,
            () => this.urlWrapper.query.mutations_transcript_id
        );
        this.mutationMapperStoreByGeneWithDriverKey[
            this.getGeneWithDriverKey(gene)
        ] = store;
        return store;
    }

    public getMutationMapperStore(
        gene: Gene
    ): ResultsViewMutationMapperStore | undefined {
        if (
            this.genes.isComplete &&
            this.oncoKbCancerGenes.isComplete &&
            this.uniqueSampleKeyToTumorType.isComplete &&
            this.mutations.isComplete &&
            this.mutationsByGene.isComplete
        ) {
            return this.mutationMapperStoreByGeneWithDriverKey[
                this.getGeneWithDriverKey(gene)
            ]
                ? this.mutationMapperStoreByGeneWithDriverKey[
                      this.getGeneWithDriverKey(gene)
                  ]
                : this.createMutationMapperStoreForSelectedGene(gene);
        }
        return undefined;
    }

    // Need to add "DRIVER" into key because mutation mapper store is cached
    // if we don't do this, starting with no driver then switch to driver will get wrong filter results
    private getGeneWithDriverKey(gene: Gene) {
        return `${gene.hugoGeneSymbol}_${
            this.isPutativeDriver ? 'DRIVER' : 'NO_DRIVER'
        }`;
    }

    readonly oncoKbCancerGenes = remoteData(
        {
            invoke: () => {
                if (AppConfig.serverConfig.show_oncokb) {
                    return fetchOncoKbCancerGenes();
                } else {
                    return Promise.resolve([]);
                }
            },
        },
        []
    );

    readonly oncoKbAnnotatedGenes = remoteData(
        {
            await: () => [this.oncoKbCancerGenes],
            invoke: () => {
                if (AppConfig.serverConfig.show_oncokb) {
                    return Promise.resolve(
                        _.reduce(
                            this.oncoKbCancerGenes.result,
                            (
                                map: { [entrezGeneId: number]: boolean },
                                next: CancerGene
                            ) => {
                                if (next.oncokbAnnotated) {
                                    map[next.entrezGeneId] = true;
                                }
                                return map;
                            },
                            {}
                        )
                    );
                } else {
                    return Promise.resolve({});
                }
            },
        },
        {}
    );

    readonly clinicalDataForSamples = remoteData<ClinicalData[]>(
        {
            await: () => [this.studies, this.samples],
            invoke: () =>
                this.getClinicalData(
                    REQUEST_ARG_ENUM.CLINICAL_DATA_TYPE_SAMPLE,
                    this.studies.result!,
                    this.samples.result,
                    [
                        CLINICAL_ATTRIBUTE_ID_ENUM.CANCER_TYPE,
                        CLINICAL_ATTRIBUTE_ID_ENUM.CANCER_TYPE_DETAILED,
                    ]
                ),
        },
        []
    );

    readonly ascnClinicalDataForSamples = remoteData<ClinicalData[]>(
        {
            await: () => [this.studies, this.samples],
            invoke: () =>
                this.getClinicalData(
                    REQUEST_ARG_ENUM.CLINICAL_DATA_TYPE_SAMPLE,
                    this.studies.result!,
                    this.samples.result,
                    [
                        CLINICAL_ATTRIBUTE_ID_ENUM.ASCN_WGD,
                        CLINICAL_ATTRIBUTE_ID_ENUM.ASCN_PURITY,
                    ]
                ),
        },
        []
    );

    @computed get sampleIds(): string[] {
        if (this.samples.result) {
            return this.samples.result.map(sample => sample.sampleId);
        }
        return [];
    }

    readonly ascnClinicalDataGroupedBySample = remoteData(
        {
            await: () => [this.ascnClinicalDataForSamples],
            invoke: async () =>
                groupBySampleId(
                    this.sampleIds,
                    this.ascnClinicalDataForSamples.result
                ),
        },
        []
    );

    readonly clinicalDataGroupedBySampleMap = remoteData(
        {
            await: () => [this.ascnClinicalDataGroupedBySample],
            invoke: async () =>
                mapSampleIdToClinicalData(
                    this.ascnClinicalDataGroupedBySample.result
                ),
        },
        {}
    );

    private getClinicalData(
        clinicalDataType: 'SAMPLE' | 'PATIENT',
        studies: any[],
        entities: any[],
        attributeIds: string[]
    ): Promise<Array<ClinicalData>> {
        // single study query endpoint is optimal so we should use it
        // when there's only one study
        if (studies.length === 1) {
            const study = this.studies.result[0];
            const filter: ClinicalDataSingleStudyFilter = {
                attributeIds: attributeIds,
                ids: _.map(
                    entities,
                    clinicalDataType === 'SAMPLE' ? 'sampleId' : 'patientId'
                ),
            };
            return client.fetchAllClinicalDataInStudyUsingPOST({
                studyId: study.studyId,
                clinicalDataSingleStudyFilter: filter,
                clinicalDataType: clinicalDataType,
            });
        } else {
            const filter: ClinicalDataMultiStudyFilter = {
                attributeIds: attributeIds,
                identifiers: entities.map((s: any) =>
                    clinicalDataType === 'SAMPLE'
                        ? { entityId: s.sampleId, studyId: s.studyId }
                        : { entityId: s.patientId, studyId: s.studyId }
                ),
            };
            return client.fetchClinicalDataUsingPOST({
                clinicalDataType: clinicalDataType,
                clinicalDataMultiStudyFilter: filter,
            });
        }
    }

    readonly germlineConsentedSamples = remoteData<SampleIdentifier[]>(
        {
            await: () => [this.studyIds, this.sampleMap],
            invoke: async () => {
                const germlineConsentedSamples: SampleIdentifier[] = await fetchGermlineConsentedSamples(
                    this.studyIds,
                    AppConfig.serverConfig.studiesWithGermlineConsentedSamples
                );

                // do not simply return all germline consented samples,
                // only include the ones matching current sample selection
                const sampleMap = this.sampleMap.result!;
                return germlineConsentedSamples.filter(s =>
                    sampleMap.has(s, ['sampleId', 'studyId'])
                );
            },
            onError: () => {
                // fail silently
            },
        },
        []
    );

    readonly samples = remoteData(
        {
            await: () => [this.studyToDataQueryFilter],
            invoke: async () => {
                let sampleIdentifiers: SampleIdentifier[] = [];
                let sampleListIds: string[] = [];
                _.each(
                    this.studyToDataQueryFilter.result,
                    (dataQueryFilter: IDataQueryFilter, studyId: string) => {
                        if (dataQueryFilter.sampleIds) {
                            sampleIdentifiers = sampleIdentifiers.concat(
                                dataQueryFilter.sampleIds.map(sampleId => ({
                                    sampleId,
                                    studyId,
                                }))
                            );
                        } else if (dataQueryFilter.sampleListId) {
                            sampleListIds.push(dataQueryFilter.sampleListId);
                        }
                    }
                );
                let promises: Promise<Sample[]>[] = [];
                if (sampleIdentifiers.length) {
                    promises.push(
                        client.fetchSamplesUsingPOST({
                            sampleFilter: {
                                sampleIdentifiers,
                            } as SampleFilter,
                            projection: REQUEST_ARG_ENUM.PROJECTION_DETAILED,
                        })
                    );
                }
                if (sampleListIds.length) {
                    promises.push(
                        client.fetchSamplesUsingPOST({
                            sampleFilter: {
                                sampleListIds,
                            } as SampleFilter,
                            projection: REQUEST_ARG_ENUM.PROJECTION_DETAILED,
                        })
                    );
                }
                return _.flatten(await Promise.all(promises));
            },
        },
        []
    );

    readonly sampleMap = remoteData({
        await: () => [this.samples],
        invoke: () => {
            return Promise.resolve(
                ComplexKeyMap.from(this.samples.result!, s => ({
                    studyId: s.studyId,
                    sampleId: s.sampleId,
                }))
            );
        },
    });

    readonly filteredSamples = remoteData({
        await: () => [
            this.samples,
            this.coverageInformation,
            this.genes,
            this.selectedMolecularProfiles,
        ],
        invoke: () => {
            if (this.hideUnprofiledSamples) {
                // only show samples that are profiled in every gene in every selected profile
                const genes = this.genes.result!;
                const coverageInfo = this.coverageInformation.result!;
                const queryProfileIds = this.selectedMolecularProfiles.result!.map(
                    p => p.molecularProfileId
                );
                return Promise.resolve(
                    this.samples.result!.filter(sample => {
                        return _.every(genes, gene => {
                            return _.every(
                                isSampleProfiledInMultiple(
                                    sample.uniqueSampleKey,
                                    queryProfileIds,
                                    coverageInfo,
                                    gene.hugoGeneSymbol
                                )
                            );
                        });
                    })
                );
            } else {
                return Promise.resolve(this.samples.result!);
            }
        },
    });

    readonly filteredSampleKeyToSample = remoteData({
        await: () => [this.filteredSamples],
        invoke: () =>
            Promise.resolve(
                _.keyBy(this.filteredSamples.result!, s => s.uniqueSampleKey)
            ),
    });

    readonly filteredPatients = remoteData({
        await: () => [
            this.filteredSamples,
            this.patients,
            this.patientKeyToPatient,
        ],
        invoke: () => {
            if (this.hideUnprofiledSamples) {
                const patientKeyToPatient = this.patientKeyToPatient.result!;
                return Promise.resolve(
                    _.uniqBy(
                        this.filteredSamples.result!.map(
                            s => patientKeyToPatient[s.uniquePatientKey]
                        ),
                        patient => patient.uniquePatientKey
                    )
                );
            } else {
                return Promise.resolve(this.patients.result!);
            }
        },
    });

    readonly filteredPatientKeyToPatient = remoteData({
        await: () => [this.filteredPatients],
        invoke: () =>
            Promise.resolve(
                _.keyBy(this.filteredPatients.result!, p => p.uniquePatientKey)
            ),
    });

    readonly sampleKeyToSample = remoteData({
        await: () => [this.samples],
        invoke: () => {
            return Promise.resolve(
                _.keyBy(this.samples.result!, sample => sample.uniqueSampleKey)
            );
        },
    });

    readonly patientKeyToPatient = remoteData({
        await: () => [this.patients],
        invoke: () => {
            return Promise.resolve(
                _.keyBy(
                    this.patients.result!,
                    patient => patient.uniquePatientKey
                )
            );
        },
    });

    readonly patientKeyToFilteredSamples = remoteData({
        await: () => [this.filteredSamples],
        invoke: () => {
            return Promise.resolve(
                _.groupBy(
                    this.filteredSamples.result!,
                    sample => sample.uniquePatientKey
                )
            );
        },
    });

    readonly patients = remoteData({
        await: () => [this.samples],
        invoke: () => fetchPatients(this.samples.result!),
        default: [],
    });

    readonly samplesWithoutCancerTypeClinicalData = remoteData<Sample[]>(
        {
            await: () => [this.samples, this.clinicalDataForSamples],
            invoke: () => {
                const sampleHasData: { [sampleUid: string]: boolean } = {};
                for (const data of this.clinicalDataForSamples.result) {
                    sampleHasData[
                        toSampleUuid(data.studyId, data.sampleId)
                    ] = true;
                }
                return Promise.resolve(
                    this.samples.result.filter(sample => {
                        return !sampleHasData[
                            toSampleUuid(sample.studyId, sample.sampleId)
                        ];
                    })
                );
            },
        },
        []
    );

    readonly studiesForSamplesWithoutCancerTypeClinicalData = remoteData(
        {
            await: () => [this.samplesWithoutCancerTypeClinicalData],
            invoke: async () =>
                fetchStudiesForSamplesWithoutCancerTypeClinicalData(
                    this.samplesWithoutCancerTypeClinicalData
                ),
        },
        []
    );

    readonly studies = remoteData(
        {
            await: () => [this.studyIds],
            invoke: async () => {
                return client.fetchStudiesUsingPOST({
                    studyIds: this.studyIds.result!,
                    projection: REQUEST_ARG_ENUM.PROJECTION_DETAILED,
                });
            },
        },
        []
    );

    @computed get referenceGenomeBuild() {
        if (!this.studies.isComplete) {
            throw new Error('Failed to get studies');
        }
        return getGenomeNexusUrl(this.studies.result);
    }

    @autobind
    generateGenomeNexusHgvsgUrl(hgvsg: string) {
        return getGenomeNexusHgvsgUrl(hgvsg, this.referenceGenomeBuild);
    }

    @computed get ensemblLink() {
        return this.referenceGenomeBuild ===
            AppConfig.serverConfig.genomenexus_url_grch38
            ? AppConfig.serverConfig.ensembl_transcript_grch38_url
            : AppConfig.serverConfig.ensembl_transcript_url;
    }

    @computed get genomeNexusClient() {
        return new GenomeNexusAPI(this.referenceGenomeBuild);
    }

    @computed get genomeNexusInternalClient() {
        return new GenomeNexusAPIInternal(this.referenceGenomeBuild);
    }

    //this is only required to show study name and description on the results page
    //CancerStudy objects for all the cohortIds
    readonly queriedStudies = remoteData({
        await: () => [this.everyStudyIdToStudy, this.queriedVirtualStudies],
        invoke: async () => {
            if (!_.isEmpty(this.cancerStudyIds)) {
                return fetchQueriedStudies(
                    this.everyStudyIdToStudy.result!,
                    this.cancerStudyIds,
                    this.queriedVirtualStudies.result
                        ? this.queriedVirtualStudies.result
                        : []
                );
            } else {
                return [];
            }
        },
        default: [],
    });

    readonly studyIdToStudy = remoteData(
        {
            await: () => [this.studies],
            invoke: () =>
                Promise.resolve(_.keyBy(this.studies.result, x => x.studyId)),
        },
        {}
    );

    readonly molecularProfilesInStudies = remoteData<MolecularProfile[]>(
        {
            await: () => [this.studyIds],
            invoke: async () => {
                return client.fetchMolecularProfilesUsingPOST({
                    molecularProfileFilter: {
                        studyIds: this.studyIds.result!,
                    } as MolecularProfileFilter,
                });
            },
        },
        []
    );

    // need to support fusion data later
    readonly nonSelectedDownloadableMolecularProfiles = remoteData<
        MolecularProfile[]
    >(
        {
            await: () => [
                this.molecularProfilesInStudies,
                this.selectedMolecularProfiles,
            ],
            invoke: () => {
                return Promise.resolve(
                    excludeSpecialMolecularProfiles(
                        _.difference(
                            this.molecularProfilesInStudies.result!,
                            this.selectedMolecularProfiles.result!
                        )
                    )
                );
            },
        },
        []
    );

    readonly molecularProfileIdToMolecularProfile = remoteData<{
        [molecularProfileId: string]: MolecularProfile;
    }>(
        {
            await: () => [this.molecularProfilesInStudies],
            invoke: () => {
                return Promise.resolve(
                    this.molecularProfilesInStudies.result.reduce(
                        (
                            map: {
                                [molecularProfileId: string]: MolecularProfile;
                            },
                            next: MolecularProfile
                        ) => {
                            map[next.molecularProfileId] = next;
                            return map;
                        },
                        {}
                    )
                );
            },
        },
        {}
    );

    readonly molecularProfileIdSuffixToMolecularProfiles = remoteData<{
        [molecularProfileIdSuffix: string]: MolecularProfile[];
    }>(
        {
            await: () => [this.molecularProfilesInStudies],
            invoke: () => {
                return Promise.resolve(
                    _.groupBy(
                        this.molecularProfilesInStudies.result,
                        molecularProfile =>
                            getSuffixOfMolecularProfile(molecularProfile)
                    )
                );
            },
        },
        {}
    );

    // If we have same profile accros multiple studies, they should have the same name, so we can group them by name to get all related molecular profiles in multiple studies.
    readonly nonSelectedDownloadableMolecularProfilesGroupByName = remoteData<{
        [profileName: string]: MolecularProfile[];
    }>(
        {
            await: () => [this.nonSelectedDownloadableMolecularProfiles],
            invoke: () => {
                const sortedProfiles = _.sortBy(
                    this.nonSelectedDownloadableMolecularProfiles.result,
                    profile =>
                        decideMolecularProfileSortingOrder(
                            profile.molecularAlterationType
                        )
                );
                return Promise.resolve(
                    _.groupBy(sortedProfiles, profile => profile.name)
                );
            },
        },
        {}
    );

    readonly studyToMolecularProfileDiscreteCna = remoteData<{
        [studyId: string]: MolecularProfile;
    }>(
        {
            await: () => [this.molecularProfilesInStudies],
            invoke: async () => {
                const ret: { [studyId: string]: MolecularProfile } = {};
                for (const molecularProfile of this.molecularProfilesInStudies
                    .result) {
                    if (
                        molecularProfile.datatype ===
                            DataTypeConstants.DISCRETE &&
                        molecularProfile.molecularAlterationType ===
                            AlterationTypeConstants.COPY_NUMBER_ALTERATION
                    ) {
                        ret[molecularProfile.studyId] = molecularProfile;
                    }
                }
                return ret;
            },
        },
        {}
    );

    readonly heatmapMolecularProfiles = remoteData<MolecularProfile[]>({
        await: () => [
            this.molecularProfilesInStudies,
            this.selectedMolecularProfiles,
            this.genesetMolecularProfile,
        ],
        invoke: () => {
            const MRNA_EXPRESSION = AlterationTypeConstants.MRNA_EXPRESSION;
            const PROTEIN_LEVEL = AlterationTypeConstants.PROTEIN_LEVEL;
            const METHYLATION = AlterationTypeConstants.METHYLATION;
            const selectedMolecularProfileIds = stringListToSet(
                this.selectedMolecularProfiles.result!.map(
                    profile => profile.molecularProfileId
                )
            );

            const expressionHeatmaps = _.sortBy(
                _.filter(this.molecularProfilesInStudies.result!, profile => {
                    return (
                        // Select mrna and protein profiles only if showProfileInAnalysisTab is true
                        // Select all methylation profiles
                        ((profile.molecularAlterationType === MRNA_EXPRESSION ||
                            profile.molecularAlterationType ===
                                PROTEIN_LEVEL) &&
                            profile.showProfileInAnalysisTab) ||
                        profile.molecularAlterationType === METHYLATION
                    );
                }),
                profile => {
                    // Sort order: selected and [mrna, protein, methylation], unselected and [mrna, protein, methylation]
                    if (
                        profile.molecularProfileId in
                        selectedMolecularProfileIds
                    ) {
                        switch (profile.molecularAlterationType) {
                            case MRNA_EXPRESSION:
                                return 0;
                            case PROTEIN_LEVEL:
                                return 1;
                            case METHYLATION:
                                return 2;
                        }
                    } else {
                        switch (profile.molecularAlterationType) {
                            case MRNA_EXPRESSION:
                                return 3;
                            case PROTEIN_LEVEL:
                                return 4;
                            case METHYLATION:
                                return 5;
                        }
                    }
                }
            );
            const genesetMolecularProfile = this.genesetMolecularProfile
                .result!;
            const genesetHeatmaps = genesetMolecularProfile.isApplicable
                ? [genesetMolecularProfile.value]
                : [];
            return Promise.resolve(expressionHeatmaps.concat(genesetHeatmaps));
        },
    });

    readonly genesetMolecularProfile = remoteData<Optional<MolecularProfile>>({
        await: () => [this.selectedMolecularProfiles],
        invoke: () => {
            const applicableProfiles = _.filter(
                this.selectedMolecularProfiles.result!,
                profile =>
                    profile.molecularAlterationType ===
                        AlterationTypeConstants.GENESET_SCORE &&
                    profile.showProfileInAnalysisTab
            );
            if (applicableProfiles.length > 1) {
                return Promise.reject(
                    new Error('Queried more than one gene set score profile')
                );
            }
            const genesetProfile = applicableProfiles.pop();
            const value: Optional<MolecularProfile> = genesetProfile
                ? { isApplicable: true, value: genesetProfile }
                : { isApplicable: false };
            return Promise.resolve(value);
        },
    });

    readonly studyToDataQueryFilter = remoteData<{
        [studyId: string]: IDataQueryFilter;
    }>(
        {
            await: () => [
                this.studyToSampleIds,
                this.studyIds,
                this.studyToSampleListId,
            ],
            invoke: () => {
                const studies = this.studyIds.result!;
                const ret: { [studyId: string]: IDataQueryFilter } = {};
                for (const studyId of studies) {
                    ret[studyId] = generateDataQueryFilter(
                        this.studyToSampleListId.result![studyId] || null,
                        Object.keys(this.studyToSampleIds.result[studyId] || {})
                    );
                }
                return Promise.resolve(ret);
            },
        },
        {}
    );

    readonly molecularProfileIdToDataQueryFilter = remoteData<{
        [molecularProfileId: string]: IDataQueryFilter;
    }>({
        await: () => [
            this.molecularProfilesInStudies,
            this.studyToDataQueryFilter,
        ],
        invoke: () => {
            const ret: { [molecularProfileId: string]: IDataQueryFilter } = {};
            for (const molecularProfile of this.molecularProfilesInStudies
                .result!) {
                ret[
                    molecularProfile.molecularProfileId
                ] = this.studyToDataQueryFilter.result![
                    molecularProfile.studyId
                ];
            }
            return Promise.resolve(ret);
        },
        default: {},
    });

    readonly genes = remoteData<Gene[]>({
        invoke: async () => {
            const genes = await fetchGenes(this.hugoGeneSymbols);

            // Check that the same genes are in the OQL query as in the API response (order doesnt matter).
            // This ensures that all the genes in OQL are valid. If not, we throw an error.
            if (
                _.isEqual(
                    _.sortBy(this.hugoGeneSymbols),
                    _.sortBy(genes.map(gene => gene.hugoGeneSymbol))
                )
            ) {
                return genes;
            } else {
                throw new Error(ErrorMessages.InvalidGenes);
            }
        },
        onResult: (genes: Gene[]) => {
            this.geneCache.addData(genes);
        },
        onError: err => {
            // throwing this allows sentry to report it
            throw err;
        },
    });

    readonly referenceGenes = remoteData<ReferenceGenomeGene[]>({
        await: () => [this.studies],
        invoke: () => {
            if (this.studies.result!.length > 0) {
                return fetchAllReferenceGenomeGenes(
                    this.studies.result[0].referenceGenome
                );
            } else {
                return Promise.resolve([]);
            }
        },
    });

    readonly hugoGeneSymbolToReferenceGene = remoteData<{
        [hugoSymbol: string]: ReferenceGenomeGene;
    }>({
        await: () => [this.referenceGenes],
        invoke: () => {
            // build reference gene map
            return Promise.resolve(
                _.keyBy(this.referenceGenes.result!, g => g.hugoGeneSymbol)
            );
        },
    });

    readonly entrezGeneIdToReferenceGene = remoteData<{
        [hugoSymbol: string]: ReferenceGenomeGene;
    }>({
        await: () => [this.referenceGenes],
        invoke: () => {
            // build reference gene map
            return Promise.resolve(
                _.keyBy(this.referenceGenes.result!, g => g.entrezGeneId)
            );
        },
    });

    @computed get referenceGenome() {
        const study = this.studies.result ? this.studies.result[0] : undefined;
        return study ? study.referenceGenome : DEFAULT_GENOME;
    }

    @computed get genesInvalid() {
        return this.genes.isError;
    }

    @computed get isQueryInvalid() {
        return (
            this.hugoGeneSymbols.length * this.samples.result.length >
            AppConfig.serverConfig.query_product_limit
        );
    }

    @computed get geneLimit(): number {
        return Math.floor(
            AppConfig.serverConfig.query_product_limit /
                this.samples.result.length
        );
    }

    readonly genesets = remoteData<Geneset[]>({
        invoke: () => {
            if (this.genesetIds && this.genesetIds.length > 0) {
                return internalClient.fetchGenesetsUsingPOST({
                    genesetIds: this.genesetIds.slice(),
                });
            } else {
                return Promise.resolve([]);
            }
        },
        onResult: (genesets: Geneset[]) => {
            this.genesetCache.addData(genesets);
        },
    });

    readonly geneticEntities = remoteData<GeneticEntity[]>({
        await: () => [
            this.genes,
            this.genesets,
            this.hugoGeneSymbolToReferenceGene,
        ],
        invoke: () => {
            const res: GeneticEntity[] = [];
            for (const gene of this.genes.result!) {
                // handle case where a gene doesn't appear in reference genome data
                const refGene = this.hugoGeneSymbolToReferenceGene.result![
                    gene.hugoGeneSymbol
                ];

                let cytoband = '';

                if (refGene && refGene.cytoband) {
                    cytoband = refGene.cytoband;
                }

                res.push({
                    geneticEntityName: gene.hugoGeneSymbol,
                    geneticEntityType: GeneticEntityType.GENE,
                    geneticEntityId: gene.entrezGeneId,
                    cytoband: cytoband,
                    geneticEntityData: gene,
                });
            }
            for (const geneset of this.genesets.result!) {
                res.push({
                    geneticEntityName: geneset.name,
                    geneticEntityType: GeneticEntityType.GENESET,
                    geneticEntityId: geneset.genesetId,
                    cytoband: '-',
                    geneticEntityData: geneset,
                });
            }
            return Promise.resolve(res);
        },
    });

    readonly genericAssayEntitiesGroupedByGenericAssayType = remoteData<{
        [genericAssayType: string]: GenericAssayMeta[];
    }>(
        {
            await: () => [this.molecularProfilesInStudies],
            invoke: async () => {
                return await fetchGenericAssayMetaByMolecularProfileIdsGroupedByGenericAssayType(
                    this.molecularProfilesInStudies.result
                );
            },
        },
        {}
    );

    readonly genericAssayEntitiesGroupByMolecularProfileId = remoteData<{
        [genericAssayType: string]: GenericAssayMeta[];
    }>({
        await: () => [this.molecularProfilesInStudies],
        invoke: async () => {
            return await fetchGenericAssayMetaByMolecularProfileIdsGroupByMolecularProfileId(
                this.molecularProfilesInStudies.result
            );
        },
    });

    readonly selectedGenericAssayEntitiesGroupedByGenericAssayType = remoteData<{
        [genericAssayType: string]: GenericAssayMeta[];
    }>({
        await: () => [this.genericAssayEntitiesGroupedByGenericAssayType],
        invoke: () => {
            return Promise.resolve(
                _.mapValues(
                    this.genericAssayEntitiesGroupedByGenericAssayType.result,
                    (value, profileId) => {
                        const selectedEntityIds = this
                            .selectedGenericAssayEntitiesGroupByMolecularProfileId[
                            profileId
                        ];
                        return value.filter(entity =>
                            selectedEntityIds.includes(entity.stableId)
                        );
                    }
                )
            );
        },
    });

    readonly entrezGeneIdToGene = remoteData<{ [entrezGeneId: number]: Gene }>({
        await: () => [this.genes],
        invoke: () =>
            Promise.resolve(
                _.keyBy(this.genes.result!, gene => gene.entrezGeneId)
            ),
    });

    readonly genesetLinkMap = remoteData<{ [genesetId: string]: string }>({
        invoke: async () => {
            if (this.genesetIds && this.genesetIds.length) {
                const genesets = await internalClient.fetchGenesetsUsingPOST({
                    genesetIds: this.genesetIds.slice(),
                });
                const linkMap: { [genesetId: string]: string } = {};
                genesets.forEach(({ genesetId, refLink }) => {
                    linkMap[genesetId] = refLink;
                });
                return linkMap;
            } else {
                return {};
            }
        },
    });

    readonly genericAssayEntitiesGroupedByGenericAssayTypeLinkMap = remoteData<{
        [genericAssayType: string]: { [stableId: string]: string };
    }>({
        await: () => [this.genericAssayEntitiesGroupedByGenericAssayType],
        invoke: async () => {
            if (
                !_.isEmpty(
                    this.genericAssayEntitiesGroupedByGenericAssayType.result
                )
            ) {
                return _.mapValues(
                    this.genericAssayEntitiesGroupedByGenericAssayType.result,
                    genericAssayEntities => {
                        const linkMap: { [stableId: string]: string } = {};
                        genericAssayEntities.forEach(entity => {
                            // if entity meta contains reference url, add the link into map
                            linkMap[
                                entity.stableId
                            ] = getGenericAssayMetaPropertyOrDefault(
                                entity,
                                COMMON_GENERIC_ASSAY_PROPERTY.URL,
                                ''
                            );
                        });
                        return linkMap;
                    }
                );
            } else {
                return {};
            }
        },
    });

    readonly genericAssayStableIdToMeta = remoteData<{
        [genericAssayStableId: string]: GenericAssayMeta;
    }>({
        await: () => [this.genericAssayEntitiesGroupByMolecularProfileId],
        invoke: () => {
            return Promise.resolve(
                _.chain(
                    this.genericAssayEntitiesGroupByMolecularProfileId.result
                )
                    .values()
                    .flatten()
                    .uniqBy(meta => meta.stableId)
                    .keyBy(meta => meta.stableId)
                    .value()
            );
        },
    });

    readonly genericAssayProfiles = remoteData<MolecularProfile[]>({
        await: () => [this.molecularProfilesInStudies],
        invoke: () => {
            return Promise.resolve(
                this.molecularProfilesInStudies.result.filter(
                    profile =>
                        profile.molecularAlterationType ===
                        AlterationTypeConstants.GENERIC_ASSAY
                )
            );
        },
    });

    readonly genericAssayProfilesGroupByProfileIdSuffix = remoteData<{
        [profileIdSuffix: string]: MolecularProfile[];
    }>({
        await: () => [this.genericAssayProfiles],
        invoke: () => {
            return Promise.resolve(
                _.groupBy(this.genericAssayProfiles.result, molecularProfile =>
                    molecularProfile.molecularProfileId.replace(
                        molecularProfile.studyId + '_',
                        ''
                    )
                )
            );
        },
    });

    readonly genericAssayEntityStableIdsGroupByProfileIdSuffix = remoteData<{
        [profileIdSuffix: string]: string[];
    }>({
        await: () => [this.genericAssayProfilesGroupByProfileIdSuffix],
        invoke: () => {
            return Promise.resolve(
                _.mapValues(
                    this.genericAssayProfilesGroupByProfileIdSuffix.result,
                    profiles => {
                        return _.chain(profiles)
                            .map(
                                profile =>
                                    this
                                        .selectedGenericAssayEntitiesGroupByMolecularProfileId[
                                        profile.molecularProfileId
                                    ]
                            )
                            .flatten()
                            .uniq()
                            .compact()
                            .value();
                    }
                )
            );
        },
    });

    readonly genericAssayDataGroupByProfileIdSuffix = remoteData<{
        [profileIdSuffix: string]: GenericAssayData[];
    }>({
        await: () => [
            this.samples,
            this.genericAssayProfilesGroupByProfileIdSuffix,
            this.genericAssayEntityStableIdsGroupByProfileIdSuffix,
        ],
        invoke: async () => {
            const genericAssayDataGroupByProfileIdSuffix: {
                [profileIdSuffix: string]: GenericAssayData[];
            } = {};

            await Promise.all(
                _.map(
                    this.genericAssayProfilesGroupByProfileIdSuffix.result,
                    (profiles, profileIdSuffix) => {
                        const molecularIds = profiles.map(
                            profile => profile.molecularProfileId
                        );
                        const stableIds = this
                            .genericAssayEntityStableIdsGroupByProfileIdSuffix
                            .result![profileIdSuffix];

                        const sampleMolecularIdentifiers = _.flatMap(
                            molecularIds,
                            molecularId =>
                                _.map(this.samples.result, sample => {
                                    return {
                                        molecularProfileId: molecularId,
                                        sampleId: sample.sampleId,
                                    } as SampleMolecularIdentifier;
                                })
                        );

                        if (
                            !_.isEmpty(stableIds) &&
                            !_.isEmpty(sampleMolecularIdentifiers)
                        ) {
                            return client
                                .fetchGenericAssayDataInMultipleMolecularProfilesUsingPOST(
                                    {
                                        genericAssayDataMultipleStudyFilter: {
                                            genericAssayStableIds: stableIds,
                                            sampleMolecularIdentifiers,
                                        } as GenericAssayDataMultipleStudyFilter,
                                    } as any
                                )
                                .then(genericAssayData => {
                                    genericAssayDataGroupByProfileIdSuffix[
                                        profileIdSuffix
                                    ] = genericAssayData;
                                });
                        }
                    }
                )
            );

            return genericAssayDataGroupByProfileIdSuffix;
        },
    });

    readonly customDriverAnnotationReport = remoteData<{
        hasBinary: boolean;
        tiers: string[];
    }>({
        await: () => [this.mutations, this.discreteCNAMolecularData],
        invoke: () => {
            return Promise.resolve(
                computeCustomDriverAnnotationReport([
                    ...this.mutations.result!,
                    ...this.discreteCNAMolecularData.result!,
                ])
            );
        },
        onResult: result => {
            initializeCustomDriverAnnotationSettings(
                result!,
                this.driverAnnotationSettings,
                this.driverAnnotationSettings.customTiersDefault,
                this.driverAnnotationSettings.oncoKb,
                this.driverAnnotationSettings.hotspots
            );
        },
    });

    readonly _filteredAndAnnotatedMutationsReport = remoteData({
        await: () => [
            this.mutations,
            this.getMutationPutativeDriverInfo,
            this.entrezGeneIdToGene,
        ],
        invoke: () => {
            return Promise.resolve(
                filterAndAnnotateMutations(
                    this.mutations.result!,
                    this.getMutationPutativeDriverInfo.result!,
                    this.entrezGeneIdToGene.result!
                )
            );
        },
    });

    readonly _filteredAndAnnotatedStructuralVariantsReport = remoteData({
        await: () => [
            this.structuralVariants,
            this.getStructuralVariantPutativeDriverInfo,
        ],
        invoke: () => {
            return Promise.resolve(
                filterAndAnnotateStructuralVariants(
                    this.structuralVariants.result!,
                    this.getStructuralVariantPutativeDriverInfo.result!
                )
            );
        },
    });

    readonly filteredAndAnnotatedMutations = remoteData<AnnotatedMutation[]>({
        await: () => [
            this._filteredAndAnnotatedMutationsReport,
            this.filteredSampleKeyToSample,
        ],
        invoke: () => {
            const filteredMutations = compileMutations(
                this._filteredAndAnnotatedMutationsReport.result!,
                this.driverAnnotationSettings.excludeVUS,
                this.excludeGermlineMutations
            );
            const filteredSampleKeyToSample = this.filteredSampleKeyToSample
                .result!;
            return Promise.resolve(
                filteredMutations.filter(
                    m => m.uniqueSampleKey in filteredSampleKeyToSample
                )
            );
        },
    });

    readonly filteredAndAnnotatedStructuralVariants = remoteData<
        AnnotatedStructuralVariant[]
    >({
        await: () => [this._filteredAndAnnotatedStructuralVariantsReport],
        invoke: () =>
            Promise.resolve(
                compileStructuralVariants(
                    this._filteredAndAnnotatedStructuralVariantsReport.result!,
                    this.driverAnnotationSettings.excludeVUS,
                    this.excludeGermlineMutations
                )
            ),
    });

    public annotatedMutationCache = new MobxPromiseCache<
        { entrezGeneId: number },
        AnnotatedMutation[]
    >(q => ({
        await: () => [
            this.mutationCache.get(q),
            this.getMutationPutativeDriverInfo,
            this.entrezGeneIdToGene,
        ],
        invoke: () => {
            const filteredAndAnnotatedReport = filterAndAnnotateMutations(
                this.mutationCache.get(q).result!,
                this.getMutationPutativeDriverInfo.result!,
                this.entrezGeneIdToGene.result!
            );
            const data = filteredAndAnnotatedReport.data
                .concat(filteredAndAnnotatedReport.vus)
                .concat(filteredAndAnnotatedReport.germline);

            return Promise.resolve(data);
        },
    }));

    readonly _filteredAndAnnotatedMolecularDataReport = remoteData({
        await: () => [
            this.molecularData,
            this.entrezGeneIdToGene,
            this.getDiscreteCNAPutativeDriverInfo,
        ],
        invoke: () =>
            Promise.resolve(
                filterAndAnnotateMolecularData(
                    this.molecularData.result!,
                    this.getDiscreteCNAPutativeDriverInfo.result!,
                    this.entrezGeneIdToGene.result!,
                    this.cnaMolecularProfileIds
                )
            ),
    });

    readonly filteredAndAnnotatedMolecularData = remoteData<
        AnnotatedNumericGeneMolecularData[]
    >({
        await: () => [
            this._filteredAndAnnotatedMolecularDataReport,
            this.filteredSampleKeyToSample,
        ],
        invoke: () => {
            let data = this._filteredAndAnnotatedMolecularDataReport.result!
                .data;
            if (!this.driverAnnotationSettings.excludeVUS) {
                data = data.concat(
                    this._filteredAndAnnotatedMolecularDataReport.result!.vus
                );
            }
            const filteredSampleKeyToSample = this.filteredSampleKeyToSample
                .result!;
            return Promise.resolve(
                data.filter(d => d.uniqueSampleKey in filteredSampleKeyToSample)
            );
        },
    });

    public annotatedCnaCache = new MobxPromiseCache<
        { entrezGeneId: number },
        CustomDriverNumericGeneMolecularData[]
    >(q => ({
        await: () =>
            this.numericGeneMolecularDataCache.await(
                [
                    this.studyToMolecularProfileDiscreteCna,
                    this.getDiscreteCNAPutativeDriverInfo,
                    this.entrezGeneIdToGene,
                ],
                studyToMolecularProfileDiscrete => {
                    return _.values(studyToMolecularProfileDiscrete).map(p => ({
                        entrezGeneId: q.entrezGeneId,
                        molecularProfileId: p.molecularProfileId,
                    }));
                }
            ),
        invoke: () => {
            const cnaData = _.flatten(
                this.numericGeneMolecularDataCache
                    .getAll(
                        _.values(
                            this.studyToMolecularProfileDiscreteCna.result!
                        ).map(p => ({
                            entrezGeneId: q.entrezGeneId,
                            molecularProfileId: p.molecularProfileId,
                        }))
                    )
                    .map(p => p.result!)
            ) as CustomDriverNumericGeneMolecularData[];
            const filteredAndAnnotatedReport = filterAndAnnotateMolecularData(
                cnaData,
                this.getDiscreteCNAPutativeDriverInfo.result!,
                this.entrezGeneIdToGene.result!
            );
            const data = filteredAndAnnotatedReport.data.concat(
                filteredAndAnnotatedReport.vus
            );

            return Promise.resolve(
                filteredAndAnnotatedReport.data.concat(
                    filteredAndAnnotatedReport.vus
                )
            );
        },
    }));

    readonly getMutationPutativeDriverInfo = remoteData({
        await: () => {
            const toAwait = [];
            if (this.driverAnnotationSettings.oncoKb) {
                toAwait.push(this.oncoKbMutationAnnotationForOncoprint);
            }
            if (this.driverAnnotationSettings.hotspots) {
                toAwait.push(this.isHotspotForOncoprint);
            }
            if (this.driverAnnotationSettings.cbioportalCount) {
                toAwait.push(this.getCBioportalCount);
            }
            if (this.driverAnnotationSettings.cosmicCount) {
                toAwait.push(this.getCosmicCount);
            }
            return toAwait;
        },
        invoke: () => {
            return Promise.resolve((mutation: Mutation): {
                oncoKb: string;
                hotspots: boolean;
                cbioportalCount: boolean;
                cosmicCount: boolean;
                customDriverBinary: boolean;
                customDriverTier?: string;
            } => {
                const getOncoKbMutationAnnotationForOncoprint = this
                    .oncoKbMutationAnnotationForOncoprint.result!;
                const oncoKbDatum:
                    | IndicatorQueryResp
                    | undefined
                    | null
                    | false =
                    this.driverAnnotationSettings.oncoKb &&
                    getOncoKbMutationAnnotationForOncoprint &&
                    !(
                        getOncoKbMutationAnnotationForOncoprint instanceof Error
                    ) &&
                    getOncoKbMutationAnnotationForOncoprint(mutation);

                const isHotspotDriver =
                    this.driverAnnotationSettings.hotspots &&
                    !(this.isHotspotForOncoprint.result instanceof Error) &&
                    this.isHotspotForOncoprint.result!(mutation);
                const cbioportalCountExceeded =
                    this.driverAnnotationSettings.cbioportalCount &&
                    this.getCBioportalCount.isComplete &&
                    this.getCBioportalCount.result!(mutation) >=
                        this.driverAnnotationSettings.cbioportalCountThreshold;
                const cosmicCountExceeded =
                    this.driverAnnotationSettings.cosmicCount &&
                    this.getCosmicCount.isComplete &&
                    this.getCosmicCount.result!(mutation) >=
                        this.driverAnnotationSettings.cosmicCountThreshold;

                // Note: custom driver annotations are part of the incoming datum
                return evaluateMutationPutativeDriverInfo(
                    mutation,
                    oncoKbDatum,
                    this.driverAnnotationSettings.hotspots,
                    isHotspotDriver,
                    this.driverAnnotationSettings.cbioportalCount,
                    cbioportalCountExceeded,
                    this.driverAnnotationSettings.cosmicCount,
                    cosmicCountExceeded,
                    this.driverAnnotationSettings.customBinary,
                    this.driverAnnotationSettings.driverTiers
                );
            });
        },
    });

    readonly getStructuralVariantPutativeDriverInfo = remoteData({
        await: () => {
            const toAwait = [];
            if (this.driverAnnotationSettings.oncoKb) {
                toAwait.push(
                    this.oncoKbStructuralVariantAnnotationForOncoprint
                );
            }
            return toAwait;
        },
        invoke: () => {
            return Promise.resolve((structualVariant: StructuralVariant): {
                oncoKb: string;
                hotspots: boolean;
                cbioportalCount: boolean;
                cosmicCount: boolean;
                customDriverBinary: boolean;
                customDriverTier?: string;
            } => {
                const getOncoKbStructuralVariantAnnotationForOncoprint = this
                    .oncoKbStructuralVariantAnnotationForOncoprint.result!;
                const oncoKbDatum:
                    | IndicatorQueryResp
                    | undefined
                    | null
                    | false =
                    this.driverAnnotationSettings.oncoKb &&
                    getOncoKbStructuralVariantAnnotationForOncoprint &&
                    !(
                        getOncoKbStructuralVariantAnnotationForOncoprint instanceof
                        Error
                    ) &&
                    getOncoKbStructuralVariantAnnotationForOncoprint(
                        structualVariant
                    );

                let oncoKb: string = '';
                if (oncoKbDatum) {
                    oncoKb = getOncoKbOncogenic(oncoKbDatum);
                }
                return {
                    oncoKb,
                    hotspots: false,
                    cbioportalCount: false,
                    cosmicCount: false,
                    customDriverBinary: false,
                    customDriverTier: undefined,
                };
            });
        },
    });

    readonly getDiscreteCNAPutativeDriverInfo = remoteData({
        await: () => {
            const toAwait = [];
            if (this.driverAnnotationSettings.oncoKb) {
                toAwait.push(this.getOncoKbCnaAnnotationForOncoprint);
            }
            return toAwait;
        },
        invoke: () => {
            return Promise.resolve(
                (
                    cnaDatum: CustomDriverNumericGeneMolecularData
                ): {
                    oncoKb: string;
                    customDriverBinary: boolean;
                    customDriverTier?: string | undefined;
                } => {
                    const getOncoKBAnnotationFunc = this
                        .getOncoKbCnaAnnotationForOncoprint.result!;
                    const oncoKbDatum:
                        | IndicatorQueryResp
                        | undefined
                        | null
                        | false =
                        this.driverAnnotationSettings.oncoKb &&
                        getOncoKBAnnotationFunc &&
                        !(getOncoKBAnnotationFunc instanceof Error) &&
                        getOncoKBAnnotationFunc(cnaDatum);

                    // Note: custom driver annotations are part of the incoming datum
                    return evaluateDiscreteCNAPutativeDriverInfo(
                        cnaDatum,
                        oncoKbDatum,
                        this.driverAnnotationSettings.customBinary,
                        this.driverAnnotationSettings.driverTiers
                    );
                }
            );
        },
    });

    // Mutation annotation
    // genome nexus
    readonly indexedVariantAnnotations = remoteData<
        { [genomicLocation: string]: VariantAnnotation } | undefined
    >(
        {
            await: () => [this.mutations],
            invoke: async () =>
                AppConfig.serverConfig.show_transcript_dropdown &&
                this.mutations.result
                    ? await fetchVariantAnnotationsIndexedByGenomicLocation(
                          this.mutations.result,
                          [
                              GENOME_NEXUS_ARG_FIELD_ENUM.ANNOTATION_SUMMARY,
                              GENOME_NEXUS_ARG_FIELD_ENUM.HOTSPOTS,
                              AppConfig.serverConfig.show_signal
                                  ? GENOME_NEXUS_ARG_FIELD_ENUM.SIGNAL
                                  : '',
                          ].filter(f => f),
                          AppConfig.serverConfig.isoformOverrideSource,
                          this.genomeNexusClient
                      )
                    : undefined,
            onError: (err: Error) => {
                // fail silently, leave the error handling responsibility to the data consumer
            },
        },
        undefined
    );

    // Hotspots
    readonly hotspotData = remoteData({
        await: () => [this.mutations],
        invoke: () => {
            return fetchHotspotsData(
                this.mutations,
                undefined,
                this.genomeNexusInternalClient
            );
        },
    });

    readonly indexedHotspotData = remoteData<IHotspotIndex | undefined>({
        await: () => [this.hotspotData],
        invoke: () => Promise.resolve(indexHotspotsData(this.hotspotData)),
    });

    public readonly isHotspotForOncoprint = remoteData<
        ((m: Mutation) => boolean) | Error
    >({
        invoke: () => makeIsHotspotForOncoprint(this.indexedHotspotData),
    });
    //OncoKb
    readonly uniqueSampleKeyToTumorType = remoteData<{
        [uniqueSampleKey: string]: string;
    }>({
        await: () => [
            this.clinicalDataForSamples,
            this.studiesForSamplesWithoutCancerTypeClinicalData,
            this.samplesWithoutCancerTypeClinicalData,
        ],
        invoke: () => {
            return Promise.resolve(
                generateUniqueSampleKeyToTumorTypeMap(
                    this.clinicalDataForSamples,
                    this.studiesForSamplesWithoutCancerTypeClinicalData,
                    this.samplesWithoutCancerTypeClinicalData
                )
            );
        },
    });

    //we need seperate oncokb data because oncoprint requires onkb queries across cancertype
    //mutations tab the opposite
    readonly oncoKbDataForOncoprint = remoteData<IOncoKbData | Error>(
        {
            await: () => [this.mutations, this.oncoKbAnnotatedGenes],
            invoke: async () =>
                fetchOncoKbDataForOncoprint(
                    this.oncoKbAnnotatedGenes,
                    this.mutations
                ),
            onError: (err: Error) => {
                // fail silently, leave the error handling responsibility to the data consumer
            },
        },
        ONCOKB_DEFAULT
    );

    readonly structuralVariantOncoKbDataForOncoprint = remoteData<
        IOncoKbData | Error
    >(
        {
            await: () => [this.structuralVariants, this.oncoKbAnnotatedGenes],
            invoke: async () => {
                if (AppConfig.serverConfig.show_oncokb) {
                    let result;
                    try {
                        result = await fetchStructuralVariantOncoKbData(
                            this.uniqueSampleKeyToTumorType.result || {},
                            this.oncoKbAnnotatedGenes.result!,
                            this.structuralVariants
                        );
                    } catch (e) {
                        result = new Error();
                    }
                    return result;
                } else {
                    return ONCOKB_DEFAULT;
                }
            },
            onError: (err: Error) => {
                // fail silently, leave the error handling responsibility to the data consumer
            },
        },
        ONCOKB_DEFAULT
    );

    //we need seperate oncokb data because oncoprint requires onkb queries across cancertype
    //mutations tab the opposite
    readonly cnaOncoKbDataForOncoprint = remoteData<IOncoKbData | Error>(
        {
            await: () => [
                this.uniqueSampleKeyToTumorType,
                this.oncoKbAnnotatedGenes,
                this.discreteCNAMolecularData,
            ],
            invoke: async () =>
                fetchCnaOncoKbDataForOncoprint(
                    this.oncoKbAnnotatedGenes,
                    this.discreteCNAMolecularData
                ),
        },
        ONCOKB_DEFAULT
    );

    @computed get didOncoKbFailInOncoprint() {
        // check in this order so that we don't trigger invoke
        return (
            this.oncoKbMutationAnnotationForOncoprint.peekStatus ===
                'complete' &&
            this.oncoKbMutationAnnotationForOncoprint.result instanceof Error
        );
    }

    @computed get didHotspotFailInOncoprint() {
        // check in this order so that we don't trigger invoke
        return (
            this.isHotspotForOncoprint.peekStatus === 'complete' &&
            this.isHotspotForOncoprint.result instanceof Error
        );
    }

    readonly oncoKbMutationAnnotationForOncoprint = remoteData<
        Error | ((mutation: Mutation) => IndicatorQueryResp | undefined)
    >({
        await: () => [this.oncoKbDataForOncoprint],
        invoke: () =>
            makeGetOncoKbMutationAnnotationForOncoprint(
                this.oncoKbDataForOncoprint
            ),
    });

    readonly oncoKbStructuralVariantAnnotationForOncoprint = remoteData<
        | Error
        | ((
              structuralVariant: StructuralVariant
          ) => IndicatorQueryResp | undefined)
    >({
        await: () => [
            this.structuralVariantOncoKbDataForOncoprint,
            this.uniqueSampleKeyToTumorType,
        ],
        invoke: () => {
            const structuralVariantOncoKbDataForOncoprint = this
                .structuralVariantOncoKbDataForOncoprint.result!;
            if (structuralVariantOncoKbDataForOncoprint instanceof Error) {
                return Promise.resolve(new Error());
            } else {
                return Promise.resolve(
                    (structuralVariant: StructuralVariant) => {
                        const id = generateQueryStructuralVariantId(
                            structuralVariant.site1EntrezGeneId,
                            structuralVariant.site2EntrezGeneId,
                            cancerTypeForOncoKb(
                                structuralVariant.uniqueSampleKey,
                                this.uniqueSampleKeyToTumorType.result || {}
                            )
                        );
                        return structuralVariantOncoKbDataForOncoprint.indicatorMap![
                            id
                        ];
                    }
                );
            }
        },
    });

    readonly getOncoKbCnaAnnotationForOncoprint = remoteData<
        | Error
        | ((data: NumericGeneMolecularData) => IndicatorQueryResp | undefined)
    >({
        await: () => [this.cnaOncoKbDataForOncoprint],
        invoke: () =>
            makeGetOncoKbCnaAnnotationForOncoprint(
                this.cnaOncoKbDataForOncoprint,
                this.driverAnnotationSettings.oncoKb
            ),
    });

    readonly cbioportalMutationCountData = remoteData<{
        [mutationCountByPositionKey: string]: number;
    }>({
        await: () => [this.mutations],
        invoke: async () => {
            const mutationPositionIdentifiers = _.values(
                countMutations(this.mutations.result!)
            );

            if (mutationPositionIdentifiers.length > 0) {
                const data = await internalClient.fetchMutationCountsByPositionUsingPOST(
                    {
                        mutationPositionIdentifiers,
                    }
                );
                return _.mapValues(
                    _.groupBy(data, mutationCountByPositionKey),
                    (counts: MutationCountByPosition[]) =>
                        _.sumBy(counts, c => c.count)
                );
            } else {
                return {};
            }
        },
    });

    readonly getCBioportalCount: MobxPromise<
        (mutation: Mutation) => number
    > = remoteData({
        await: () => [this.cbioportalMutationCountData],
        invoke: () => {
            return Promise.resolve((mutation: Mutation): number => {
                const key = mutationCountByPositionKey(mutation);
                return this.cbioportalMutationCountData.result![key] || -1;
            });
        },
    });
    //COSMIC count
    readonly cosmicCountsByKeywordAndStart = remoteData<ComplexKeyCounter>({
        await: () => [this.mutations],
        invoke: async () => {
            const keywords = _.uniq(
                this.mutations
                    .result!.filter((m: Mutation) => {
                        // keyword is what we use to query COSMIC count with, so we need
                        //  the unique list of mutation keywords to query. If a mutation has
                        //  no keyword, it cannot be queried for.
                        return !!m.keyword;
                    })
                    .map((m: Mutation) => m.keyword)
            );

            if (keywords.length > 0) {
                const data = await internalClient.fetchCosmicCountsUsingPOST({
                    keywords,
                });
                const map = new ComplexKeyCounter();
                for (const d of data) {
                    const position = getProteinPositionFromProteinChange(
                        d.proteinChange
                    );
                    if (position) {
                        map.add(
                            {
                                keyword: d.keyword,
                                start: position.start,
                            },
                            d.count
                        );
                    }
                }
                return map;
            } else {
                return new ComplexKeyCounter();
            }
        },
    });

    readonly getCosmicCount: MobxPromise<
        (mutation: Mutation) => number
    > = remoteData({
        await: () => [this.cosmicCountsByKeywordAndStart],
        invoke: () => {
            return Promise.resolve((mutation: Mutation): number => {
                const targetPosObj = getProteinPositionFromProteinChange(
                    mutation.proteinChange
                );
                if (targetPosObj) {
                    const keyword = mutation.keyword;
                    const cosmicCount = this.cosmicCountsByKeywordAndStart.result!.get(
                        {
                            keyword,
                            start: targetPosObj.start,
                        }
                    );
                    return cosmicCount;
                } else {
                    return -1;
                }
            });
        },
    });

    readonly molecularProfileIdToProfiledFilteredSamples = remoteData({
        await: () => [
            this.filteredSamples,
            this.coverageInformation,
            this.molecularProfilesInStudies,
        ],
        invoke: () => {
            const ret: { [molecularProfileId: string]: Sample[] } = {};
            const profileIds = this.molecularProfilesInStudies.result.map(
                x => x.molecularProfileId
            );
            const coverageInformation = this.coverageInformation.result!;
            for (const profileId of profileIds) {
                ret[profileId] = [];
            }
            let profiledReport: boolean[] = [];
            for (const sample of this.filteredSamples.result!) {
                profiledReport = isSampleProfiledInMultiple(
                    sample.uniqueSampleKey,
                    profileIds,
                    coverageInformation
                );
                for (let i = 0; i < profileIds.length; i++) {
                    if (profiledReport[i]) {
                        ret[profileIds[i]].push(sample);
                    }
                }
            }
            return Promise.resolve(ret);
        },
    });

    /*
     * For annotations of Genome Nexus we want to fetch lazily
     */
    @cached @computed get genomeNexusCache() {
        return new GenomeNexusCache(
            createVariantAnnotationsByMutationFetcher(
                [GENOME_NEXUS_ARG_FIELD_ENUM.ANNOTATION_SUMMARY],
                this.genomeNexusClient
            )
        );
    }

    @cached @computed get genomeNexusMutationAssessorCache() {
        return new GenomeNexusMutationAssessorCache(
            createVariantAnnotationsByMutationFetcher(
                [
                    GENOME_NEXUS_ARG_FIELD_ENUM.ANNOTATION_SUMMARY,
                    GENOME_NEXUS_ARG_FIELD_ENUM.MUTATION_ASSESSOR,
                ],
                this.genomeNexusClient
            )
        );
    }

    @cached @computed get pubMedCache() {
        return new PubMedCache();
    }

    @cached @computed get discreteCNACache() {
        return new DiscreteCNACache(
            this.studyToMolecularProfileDiscreteCna.result
        );
    }

    @cached @computed get cancerTypeCache() {
        return new CancerTypeCache();
    }

    @cached @computed get mutationCountCache() {
        return new MutationCountCache();
    }

    @cached @computed get pdbHeaderCache() {
        return new PdbHeaderCache();
    }

    @cached @computed get mutationDataCache() {
        return new MutationDataCache(
            this.studyToMutationMolecularProfile.result,
            this.studyToDataQueryFilter.result
        );
    }

    readonly geneMolecularDataCache = remoteData({
        await: () => [this.molecularProfileIdToDataQueryFilter],
        invoke: () => {
            return Promise.resolve(
                new GeneMolecularDataCache(
                    this.molecularProfileIdToDataQueryFilter.result
                )
            );
        },
    });

    readonly expressionProfiles = remoteData(
        {
            await: () => [this.molecularProfilesInStudies],
            invoke: () => {
                return Promise.resolve(
                    this.molecularProfilesInStudies.result.filter(
                        (profile: MolecularProfile) =>
                            isRNASeqProfile(profile.molecularProfileId)
                    )
                );
            },
        },
        []
    );

    @memoize sortRnaSeqMolecularDataByStudy(seqData: {
        [profileId: string]: NumericGeneMolecularData[];
    }) {
        return _.keyBy(seqData, (data: NumericGeneMolecularData[]) => {
            return data[0].studyId;
        });
    }

    readonly genesetMolecularDataCache = remoteData({
        await: () => [this.molecularProfileIdToDataQueryFilter],
        invoke: () =>
            Promise.resolve(
                new GenesetMolecularDataCache(
                    this.molecularProfileIdToDataQueryFilter.result!
                )
            ),
    });

    public numericGenesetMolecularDataCache = new MobxPromiseCache<
        { genesetId: string; molecularProfileId: string },
        GenesetMolecularData[]
    >(q => ({
        await: () => [this.molecularProfileIdToDataQueryFilter],
        invoke: () => {
            const dqf = this.molecularProfileIdToDataQueryFilter.result![
                q.molecularProfileId
            ];
            if (dqf) {
                return internalClient.fetchGeneticDataItemsUsingPOST({
                    geneticProfileId: q.molecularProfileId,
                    genesetDataFilterCriteria: {
                        genesetIds: [q.genesetId],
                        ...dqf,
                    } as GenesetDataFilterCriteria,
                });
            } else {
                return Promise.resolve([]);
            }
        },
    }));

    readonly genesetCorrelatedGeneCache = remoteData({
        await: () => [this.molecularProfileIdToDataQueryFilter],
        invoke: () =>
            Promise.resolve(
                new GenesetCorrelatedGeneCache(
                    this.molecularProfileIdToDataQueryFilter.result!
                )
            ),
    });

    readonly genericAssayMolecularDataCache = remoteData({
        await: () => [this.molecularProfileIdToDataQueryFilter],
        invoke: () =>
            Promise.resolve(
                new GenericAssayMolecularDataCache(
                    this.molecularProfileIdToDataQueryFilter.result!
                )
            ),
    });

    readonly geneCache = new GeneCache();
    readonly genesetCache = new GenesetCache();

    private _numericGeneMolecularDataCache = new MobxPromiseCache<
        { entrezGeneId: number; molecularProfileId: string },
        NumericGeneMolecularData[]
    >(q => ({
        await: () => [this.molecularProfileIdToDataQueryFilter],
        invoke: () => {
            const dqf = this.molecularProfileIdToDataQueryFilter.result![
                q.molecularProfileId
            ];
            // it's possible that sampleIds is empty for a given profile
            const hasSampleSpec =
                dqf &&
                ((dqf.sampleIds && dqf.sampleIds.length) || dqf.sampleListId);
            if (hasSampleSpec) {
                return client.fetchAllMolecularDataInMolecularProfileUsingPOST({
                    molecularProfileId: q.molecularProfileId,
                    molecularDataFilter: {
                        entrezGeneIds: [q.entrezGeneId],
                        ...dqf,
                    } as MolecularDataFilter,
                });
            } else {
                return Promise.resolve([]);
            }
        },
    }));
    public numericGeneMolecularDataCache = new MobxPromiseCache<
        { entrezGeneId: number; molecularProfileId: string },
        NumericGeneMolecularData[]
    >(q => ({
        await: () => [
            this._numericGeneMolecularDataCache.get(q),
            this.filteredSampleKeyToSample,
        ],
        invoke: () => {
            const data = this._numericGeneMolecularDataCache.get(q).result!;
            const sampleMap = this.filteredSampleKeyToSample.result!;
            return Promise.resolve(
                data.filter(d => d.uniqueSampleKey in sampleMap)
            );
        },
    }));

    public clinicalDataCache = new ClinicalDataCache(
        this.samples,
        this.patients,
        this.studyToMutationMolecularProfile,
        this.studyIdToStudy,
        this.coverageInformation,
        this.filteredSampleKeyToSample,
        this.filteredPatientKeyToPatient,
        this.clinicalAttributes_customCharts
    );

    public mutationCache = new MobxPromiseCache<
        { entrezGeneId: number },
        Mutation[]
    >(q => ({
        await: () => [
            this.studyToMutationMolecularProfile,
            this.studyToDataQueryFilter,
        ],
        invoke: async () => {
            return _.flatten(
                await Promise.all(
                    Object.keys(
                        this.studyToMutationMolecularProfile.result!
                    ).map(studyId => {
                        const molecularProfileId = this
                            .studyToMutationMolecularProfile.result![studyId]
                            .molecularProfileId;
                        const dataQueryFilter = this.studyToDataQueryFilter
                            .result![studyId];

                        if (
                            !dataQueryFilter ||
                            (_.isEmpty(dataQueryFilter.sampleIds) &&
                                !dataQueryFilter.sampleListId)
                        ) {
                            return Promise.resolve([]);
                        }

                        if (molecularProfileId) {
                            return client.fetchMutationsInMolecularProfileUsingPOST(
                                {
                                    molecularProfileId,
                                    mutationFilter: {
                                        entrezGeneIds: [q.entrezGeneId],
                                        ...dataQueryFilter,
                                    } as MutationFilter,
                                    projection:
                                        REQUEST_ARG_ENUM.PROJECTION_DETAILED,
                                }
                            );
                        } else {
                            return Promise.resolve([]);
                        }
                    })
                )
            );
        },
    }));

    public structuralVariantCache = new MobxPromiseCache<
        { entrezGeneId: number },
        StructuralVariant[]
    >(q => ({
        await: () => [
            this.studyToStructuralVariantMolecularProfile,
            this.studyToDataQueryFilter,
        ],
        invoke: async () => {
            const studyIdToProfileMap = this
                .studyToStructuralVariantMolecularProfile.result!;

            if (_.isEmpty(studyIdToProfileMap)) {
                return Promise.resolve([]);
            }

            const filters = this.samples.result.reduce(
                (memo, sample: Sample) => {
                    if (sample.studyId in studyIdToProfileMap) {
                        memo.push({
                            molecularProfileId:
                                studyIdToProfileMap[sample.studyId]
                                    .molecularProfileId,
                            sampleId: sample.sampleId,
                        });
                    }
                    return memo;
                },
                [] as StructuralVariantFilter['sampleMolecularIdentifiers']
            );

            return client.fetchStructuralVariantsUsingPOST({
                structuralVariantFilter: {
                    entrezGeneIds: [q.entrezGeneId],
                    sampleMolecularIdentifiers: filters,
                } as StructuralVariantFilter,
            });
        },
    }));

    @action clearErrors() {
        this.ajaxErrors = [];
    }

    @computed get isMixedReferenceGenome() {
        if (this.studies.result) {
            return isMixedReferenceGenome(this.studies.result);
        }
    }

    @computed get isPutativeDriver() {
        return this.driverAnnotationSettings.driversAnnotated
            ? (m: AnnotatedMutation) => m.putativeDriver
            : undefined;
    }
}
